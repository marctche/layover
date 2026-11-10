import { describe, expect, it } from "vitest";
import cities from "@/data/cities.json";
import { checkNewCity, formatCity, normalize, searchCities, type City } from "./search";

const data = cities as City[];

describe("searchCities", () => {
  it("ranks Paris, France first for 'par'", () => {
    const [first] = searchCities(data, "par");
    expect(first && formatCity(first)).toBe("Paris, France");
  });

  it("matches Sao Paulo without the accent", () => {
    expect(searchCities(data, "sao").map((c) => c.asciiName)).toContain("Sao Paulo");
  });

  it("is accent and case insensitive in both directions", () => {
    const names = searchCities(data, "SÃO pau").map((c) => c.asciiName);
    expect(names).toContain("Sao Paulo");
    expect(searchCities(data, "zurich").map((c) => c.asciiName)).toEqual(searchCities(data, "Zürich").map((c) => c.asciiName));
  });

  it("matches the start of any word", () => {
    expect(searchCities(data, "york").map((c) => c.name)).toContain("New York City");
  });

  it("returns nothing for an empty or blank query", () => {
    expect(searchCities(data, "")).toEqual([]);
    expect(searchCities(data, "   ")).toEqual([]);
  });

  it("respects the limit", () => {
    expect(searchCities(data, "s", 3)).toHaveLength(3);
    expect(searchCities(data, "s")).toHaveLength(8);
    expect(searchCities(data, "s", 0)).toEqual([]);
  });

  it("keeps population order", () => {
    const result = searchCities(data, "san");
    for (let i = 1; i < result.length; i++) expect(result[i - 1]!.population).toBeGreaterThanOrEqual(result[i]!.population);
  });
});

describe("normalize", () => {
  it("strips accents and punctuation", () => {
    expect(normalize("  São-Paulo ")).toBe("sao paulo");
  });
});

describe("checkNewCity", () => {
  it("blocks duplicates regardless of accents and case", () => {
    expect(checkNewCity(["Sao Paulo, Brazil"], "SÃO PAULO, brazil", 8)).toContain("already on the list");
  });
  it("blocks the ninth city and allows the eighth", () => {
    const seven = Array.from({ length: 7 }, (_, i) => `City ${i}`);
    expect(checkNewCity(seven, "Paris, France", 8)).toBeNull();
    expect(checkNewCity([...seven, "X"], "Paris, France", 8)).toContain("at most 8");
  });
});
