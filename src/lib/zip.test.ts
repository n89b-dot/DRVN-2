import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, inflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { zipStream } from "./zip";

async function collect(entries: { name: string; data: Uint8Array }[]) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of zipStream(entries, new Date("2026-11-07T12:34:56Z"))) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Reads the central directory back, as an unzip tool would. */
function readZip(zip: Buffer) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files: { name: string; text: string }[] = [];
  for (let i = 0; i < count; i += 1) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const crc = zip.readUInt32LE(at + 16);
    const packed = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const dataAt = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = inflateRawSync(zip.subarray(dataAt, dataAt + packed));
    expect(crc32(data) >>> 0).toBe(crc);
    files.push({ name, text: data.toString("utf8") });
    at += 46 + nameLength;
  }
  return files;
}

describe("N47 the export downloads as one archive", () => {
  it("holds every file intact, with checksums an unzip tool accepts", async () => {
    const zip = await collect([
      { name: "manifest.json", data: Buffer.from('{"sections":2}') },
      { name: "sections/profiles-0000.json", data: Buffer.from('[{"username":"neil","bio":"Café ☕"}]') },
    ]);
    expect(readZip(zip)).toEqual([
      { name: "manifest.json", text: '{"sections":2}' },
      { name: "sections/profiles-0000.json", text: '[{"username":"neil","bio":"Café ☕"}]' },
    ]);
    // And a real unzip tool agrees, where one is installed.
    let unzip: string | null = null;
    try {
      unzip = execFileSync("which", ["unzip"], { encoding: "utf8" }).trim() || null;
    } catch {
      unzip = null;
    }
    if (unzip) {
      const dir = mkdtempSync(join(tmpdir(), "drvn-zip-"));
      writeFileSync(join(dir, "export.zip"), zip);
      expect(execFileSync(unzip, ["-tq", join(dir, "export.zip")], { encoding: "utf8" })).toContain("No errors");
      execFileSync(unzip, ["-q", join(dir, "export.zip"), "-d", join(dir, "out")]);
      expect(readFileSync(join(dir, "out/sections/profiles-0000.json"), "utf8")).toContain("Café ☕");
    }
  });

  it("an empty export is still a valid archive", async () => {
    expect(readZip(await collect([]))).toEqual([]);
  });

  it("refuses names that would write outside the folder it's opened in", async () => {
    await expect(collect([{ name: "../etc/passwd", data: Buffer.from("x") }])).rejects.toThrow("Unsafe entry name");
    await expect(collect([{ name: "/abs.json", data: Buffer.from("x") }])).rejects.toThrow("Unsafe entry name");
  });
});
