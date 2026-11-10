import { describe, expect, it } from "vitest";

import { anyUnsignedMemberPhoto, timedCopy } from "./photo-copies";

const O = "https://proj.supabase.co/storage/v1/object";
const unsigned = `${O}/public/car-images/11111111-1111-4111-8111-111111111111/cover.webp`;
const signed = `${O}/sign/car-images/11111111-1111-4111-8111-111111111111/cover.webp?token=abc`;

type Card = { title: string; cover: string | null };
const allSigned = (cards: Card[]) => !anyUnsignedMemberPhoto(cards.map((card) => card.cover));

/** A copy on a clock the test moves, with a loader that answers from a list and counts its calls. */
function copyOf(answers: (Card[] | Error)[], maxAgeMs = 60_000) {
  const clock = { now: 1_000_000 };
  const state = { loads: 0 };
  const get = timedCopy<Card[]>(
    async () => {
      state.loads += 1;
      const next = answers.shift();
      if (!next) throw new Error("the test ran out of answers");
      if (next instanceof Error) throw next;
      return next;
    },
    { maxAgeMs, keep: allSigned, now: () => clock.now },
  );
  return { clock, state, get };
}

describe("N1062: a kept copy of signed photos is never older than its time, and never one read while signing was down (reviews of #210 and #244)", () => {
  it("N1062: looks at the photo fields it is given, not at words a member wrote", () => {
    expect(anyUnsignedMemberPhoto([signed, unsigned])).toBe(true);
    expect(anyUnsignedMemberPhoto([signed, null, undefined, "/seed/cars/1.webp", `${O}/public/avatars/me.webp`])).toBe(false);
    expect(anyUnsignedMemberPhoto([])).toBe(false);
    // A title that quotes an unsigned photo's address is not a photo: the copy is still kept.
    expect(allSigned([{ title: `see ${unsigned}`, cover: signed }])).toBe(true);
  });

  it("N1062: a signed result is handed out from the copy for its time, then read again; never served older", async () => {
    const first = [{ title: "one", cover: signed }];
    const second = [{ title: "two", cover: signed }];
    const { clock, state, get } = copyOf([first, second]);
    expect(await get()).toBe(first);
    clock.now += 59_999;
    expect(await get()).toBe(first);
    expect(state.loads).toBe(1);
    clock.now += 1;
    expect(await get()).toBe(second);
    expect(state.loads).toBe(2);
  });

  it("N1062: a result holding an unsigned photo reaches its caller and is not kept; nor is the copy from before it", async () => {
    const good = [{ title: "good", cover: signed }];
    const bad = [{ title: "bad", cover: unsigned }];
    const better = [{ title: "better", cover: signed }];
    const { clock, state, get } = copyOf([good, bad, better]);
    expect(await get()).toBe(good);
    // The copy runs out while the signer has no answer: this visitor sees the plate.
    clock.now += 60_000;
    expect(await get()).toBe(bad);
    // The next visitor, a moment later, is not handed the bad result, and not the old good one either: it is read again.
    clock.now += 1;
    expect(await get()).toBe(better);
    expect(state.loads).toBe(3);
  });

  it("N1062: a read that fails keeps nothing, and an hour of failed reads never brings the old copy back", async () => {
    const good = [{ title: "good", cover: signed }];
    const down = new Error("database down");
    const { clock, state, get } = copyOf([good, down, down, down, [{ title: "back", cover: signed }]]);
    expect(await get()).toBe(good);
    for (const later of [60_000, 20 * 60_000, 60 * 60_000]) {
      clock.now += later;
      await expect(get()).rejects.toThrow("database down");
    }
    expect((await get())[0].title).toBe("back");
    expect(state.loads).toBe(5);
  });

  it("N1062: callers that arrive during one read share it", async () => {
    let release!: (cards: Card[]) => void;
    let loads = 0;
    const get = timedCopy<Card[]>(() => { loads += 1; return new Promise((resolve) => { release = resolve; }); }, { maxAgeMs: 60_000, keep: allSigned, now: () => 5 });
    const waiting = [get(), get(), get()];
    release([{ title: "one", cover: signed }]);
    const results = await Promise.all(waiting);
    expect(new Set(results).size).toBe(1);
    expect(loads).toBe(1);
  });
});
