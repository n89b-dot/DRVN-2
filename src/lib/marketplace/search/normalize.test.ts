import { describe, expect, it } from "vitest";

import { classifyQuery, compactForm } from "./normalize";

describe("classifyQuery", () => {
  it("routes human queries to the human lane", () => {
    for (const q of ["mk8 intake", "bilstein b16", "golf r downpipe", "ea888 intercooler", "b16", "coilovers"]) {
      expect(classifyQuery(q).kind, q).toBe("human");
    }
  });

  it("routes part identifiers to the identifier lane", () => {
    for (const q of ["11427566327", "11-42-7-566-327", "CP9660-2S4", "06K145874F"]) {
      expect(classifyQuery(q).kind, q).toBe("identifier");
    }
  });

  it("normalizes separator variants to one compact form", () => {
    expect(classifyQuery("11-42-7-566-327").compact).toBe("11427566327");
    expect(classifyQuery("CP9660-2S4").compact).toBe("cp96602s4");
    expect(compactForm("06K.145.874 F")).toBe("06k145874f");
  });

  it("strips PostgREST separators from the term", () => {
    expect(classifyQuery("intake, (oem)").term).toBe("intake   oem");
  });
});
