import { describe, expect, it } from "vitest";

import { platformLabel, provenanceLine, vehicleLabel } from "./label";

describe("vehicleLabel", () => {
  it("joins year, make, model and trim with single spaces", () => {
    expect(vehicleLabel({ year: 2019, make: "Volkswagen", model: "Golf R" })).toBe(
      "2019 Volkswagen Golf R"
    );
    expect(vehicleLabel({ year: 2022, make: "Porsche", model: "911", trim: "GT3" })).toBe(
      "2022 Porsche 911 GT3"
    );
  });

  it("never normalises automotive casing", () => {
    for (const label of ["BMW M3", "VW GTI", "Audi RS3", "Toyota GR Corolla", "bmw e46"]) {
      const [make, ...model] = label.split(" ");
      expect(vehicleLabel({ make, model: model.join(" ") })).toBe(label);
    }
  });

  it("drops missing, blank and zero parts without leaving gaps", () => {
    expect(vehicleLabel({ year: null, make: " BMW ", model: "" })).toBe("BMW");
    expect(vehicleLabel({ year: 0, make: "Mazda", model: "RX-7" })).toBe("Mazda RX-7");
    expect(vehicleLabel({})).toBe("");
    expect(vehicleLabel(null)).toBe("");
  });

  it("accepts string years from form state", () => {
    expect(vehicleLabel({ year: "2003", make: "BMW", model: "M3" })).toBe("2003 BMW M3");
  });
});

describe("platformLabel / provenanceLine", () => {
  it("names the platform without a year", () => {
    expect(platformLabel({ make: "Subaru", model: "WRX STI" })).toBe("Subaru WRX STI");
    expect(platformLabel({ make: null, model: "WRX STI" })).toBe("WRX STI");
  });

  it("only writes a provenance line when there is a car to name", () => {
    expect(provenanceLine(" 2019 Volkswagen Golf R ")).toBe("2019 Volkswagen Golf R");
    expect(provenanceLine("")).toBeNull();
    expect(provenanceLine(null)).toBeNull();
  });
});
