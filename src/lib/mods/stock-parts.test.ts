import { describe, expect, it } from "vitest";
import { MOD_TYPES, modTypeFor, PICK_LIST, stockLineLabel } from "./stock-parts";

describe("what came off", () => {
  it("reads the finer mod type from the product name", () => {
    expect(modTypeFor("KW V3 Coilovers")?.key).toBe("coilovers");
    expect(modTypeFor("Coilover springs 10k")?.key).toBe("coilovers");
    expect(modTypeFor("Eibach Pro-Kit lowering springs")?.key).toBe("springs");
    expect(modTypeFor("Whiteline rear sway bar end links")?.key).toBe("end-links");
    expect(modTypeFor("034 rear anti-roll bar")?.key).toBe("sway-bars");
    expect(modTypeFor("CTS Turbo high-flow downpipe")?.key).toBe("downpipe");
    expect(modTypeFor("Milltek cat-back exhaust")?.key).toBe("exhaust");
    expect(modTypeFor("Wagner Tuning EVO 1 intercooler")?.key).toBe("intercooler");
    expect(modTypeFor("Volk TE37 18x9.5")?.key).toBe("wheels");
    expect(modTypeFor("StopTech big brake kit")?.key).toBe("big-brake-kit");
  });

  it("returns null when it can't tell, so the editor asks", () => {
    expect(modTypeFor("")).toBeNull();
    expect(modTypeFor("Stage 2 tune")).toBeNull();
    expect(modTypeFor("Momo steering wheel")).toBeNull();
  });

  it("offers a few items at most", () => {
    for (const t of MOD_TYPES) {
      expect(t.stock.length).toBeGreaterThan(0);
      expect(t.stock.length).toBeLessThanOrEqual(3);
    }
    expect(PICK_LIST.every(Boolean)).toBe(true);
    expect(PICK_LIST.length).toBeLessThanOrEqual(8);
  });

  it("names a set by its count", () => {
    expect(stockLineLabel({ label: "Stock springs", qty: 4 })).toBe("Stock springs ×4");
    expect(stockLineLabel({ label: "Stock downpipe" })).toBe("Stock downpipe");
  });
});
