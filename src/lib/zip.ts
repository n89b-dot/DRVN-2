import { crc32, deflateRawSync } from "node:zlib";

/**
 * A minimal ZIP writer (deflate, UTF-8 names, no ZIP64), for the account
 * export download (OS-W11 N47): one file a member can open, instead of a JSON
 * list of links that expired in ten minutes. Entries are produced one at a
 * time, so the caller can fetch each from storage as the archive streams.
 * Archives over 4 GB, or with over 65,535 entries, are refused rather than
 * written wrong.
 */
export type ZipEntry = { name: string; data: Uint8Array };

const LIMIT = 0xffffffff;

function dosDateTime(date: Date): { time: number; day: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

/** Yields the archive's bytes: each entry as it arrives, then the directory. */
export async function* zipStream(entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>, modified = new Date()): AsyncGenerator<Uint8Array> {
  const { time, day } = dosDateTime(modified);
  const central: Buffer[] = [];
  let offset = 0;
  let count = 0;
  for await (const entry of entries) {
    if (!entry.name || entry.name.startsWith("/") || entry.name.split("/").includes("..")) throw new Error("Unsafe entry name");
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.from(entry.data);
    const packed = deflateRawSync(raw);
    const crc = crc32(raw) >>> 0;
    if (raw.length > LIMIT || packed.length > LIMIT || offset > LIMIT) throw new Error("Archive too large");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4); // made by
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(8, 10);
    head.writeUInt16LE(time, 12);
    head.writeUInt16LE(day, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(packed.length, 20);
    head.writeUInt32LE(raw.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(head, name);
    yield local;
    yield name;
    yield packed;
    offset += local.length + name.length + packed.length;
    count += 1;
    if (count > 0xffff) throw new Error("Too many entries");
  }
  const directory = Buffer.concat(central);
  if (offset > LIMIT || directory.length > LIMIT) throw new Error("Archive too large");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  yield directory;
  yield end;
}

/** The archive as a web stream, for a Response body. */
export function zipResponseStream(entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>, modified?: Date): ReadableStream<Uint8Array> {
  const iterator = zipStream(entries, modified);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}
