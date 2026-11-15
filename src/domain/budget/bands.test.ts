import { describe, expect, it } from "vitest";
import { BUDGET_BANDS, bandCeilingMinor, bandForAmount, bandLabel, bandOptions, isBudgetBand } from "./bands";

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

describe("bandForAmount", () => {
  it("puts each boundary in the upper band and the cent below it in the lower band", () => {
    const cases: [number, string][] = [
      [0, "under_2k"],
      [1, "under_2k"],
      [199_999, "under_2k"], // 1999.99
      [200_000, "2k_3k"], // 2000
      [299_999, "2k_3k"], // 2999.99
      [300_000, "3k_4k"], // 3000
      [399_999, "3k_4k"], // 3999.99
      [400_000, "4k_plus"], // 4000
      [98_765_432_100, "4k_plus"],
    ];
    for (const [minor, band] of cases) expect(bandForAmount(minor, "CAD"), String(minor)).toBe(band);
  });
  it("uses whole units for a zero-decimal currency", () => {
    expect(bandForAmount(1999, "JPY")).toBe("under_2k");
    expect(bandForAmount(2000, "JPY")).toBe("2k_3k");
    expect(bandForAmount(2999, "JPY")).toBe("2k_3k");
    expect(bandForAmount(3000, "JPY")).toBe("3k_4k");
    expect(bandForAmount(3999, "JPY")).toBe("3k_4k");
    expect(bandForAmount(4000, "JPY")).toBe("4k_plus");
  });
  it("agrees with bandCeilingMinor: a band's top is the first amount of the next band", () => {
    expect(bandForAmount(bandCeilingMinor("under_2k", "USD")!, "USD")).toBe("2k_3k");
    expect(bandForAmount(bandCeilingMinor("3k_4k", "USD")!, "USD")).toBe("4k_plus");
  });
  it("rejects negative and non-integer amounts", () => {
    expect(() => bandForAmount(-1, "CAD")).toThrow(RangeError);
    expect(() => bandForAmount(1.5, "CAD")).toThrow(RangeError);
  });
});
