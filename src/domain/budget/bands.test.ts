import { describe, expect, it } from "vitest";
import { BUDGET_BANDS, bandCeilingMinor, bandLabel, bandOptions, isBudgetBand } from "./bands";

describe("bandCeilingMinor", () => {
  it("is the band's top in minor units", () => {
    expect(bandCeilingMinor("under_2k", "CAD")).toBe(200_000);
    expect(bandCeilingMinor("2k_3k", "CAD")).toBe(300_000);
    expect(bandCeilingMinor("3k_4k", "USD")).toBe(400_000);
  });
  it("uses the currency's minor unit digits", () => {
    expect(bandCeilingMinor("under_2k", "JPY")).toBe(2000);
    expect(bandCeilingMinor("3k_4k", "JPY")).toBe(4000);
  });
  it("is null for the open-ended band", () => {
    expect(bandCeilingMinor("4k_plus", "CAD")).toBeNull();
    expect(bandCeilingMinor("4k_plus", "JPY")).toBeNull();
  });
});

describe("labels", () => {
  it("are written in the trip currency", () => {
    expect(bandOptions("CAD").map((o) => o.band)).toEqual([...BUDGET_BANDS]);
    expect(bandLabel("under_2k", "CAD")).toContain("2,000");
    expect(bandLabel("2k_3k", "EUR")).toContain("€");
    expect(bandLabel("4k_plus", "CAD")).toContain("4,000");
    expect(bandLabel("4k_plus", "CAD")).toContain("or more");
  });
});

describe("isBudgetBand", () => {
  it("accepts only the four bands", () => {
    expect(BUDGET_BANDS.every(isBudgetBand)).toBe(true);
    expect(isBudgetBand("5k")).toBe(false);
    expect(isBudgetBand(null)).toBe(false);
  });
});
