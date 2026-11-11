import { describe, expect, it } from "vitest";
import airportData from "@/data/airports.json";
import { findAirport, formatAirport, searchAirports, type Airport } from "./search";

const AIRPORTS = airportData as Airport[];
const codes = (query: string, limit?: number) => searchAirports(AIRPORTS, query, limit).map((a) => a.iata);

describe("searchAirports", () => {
  it("ranks an exact IATA code first", () => {
    expect(codes("YYZ")[0]).toBe("YYZ");
    expect(codes("yyz")[0]).toBe("YYZ");
  });

  it("finds both Toronto airports by city", () => {
    const found = codes("toronto");
    expect(found).toContain("YYZ");
    expect(found).toContain("YTZ");
    expect(found.indexOf("YYZ")).toBeLessThan(found.indexOf("YTZ"));
  });

  it("lists Heathrow before smaller London airports", () => {
    const found = codes("london", 20);
    expect(found.indexOf("LHR")).toBeGreaterThanOrEqual(0);
    expect(found.indexOf("LHR")).toBeLessThan(found.indexOf("LCY"));
    const sizes = searchAirports(AIRPORTS, "london", 5).map((a) => a.size);
    expect(sizes.slice(0, 3)).toEqual(["large", "large", "large"]);
  });

  it("ranks a city that starts with the query above a later word match", () => {
    expect(codes("london").indexOf("LHR")).toBeLessThan(codes("london").indexOf("ELS"));
  });

  it("matches the start of any word in the airport name", () => {
    expect(codes("pearson")).toContain("YYZ");
  });

  it("ignores accents and case", () => {
    const list: Airport[] = [
      { iata: "ZRH", name: "Zürich Airport", city: "Zürich", country: "Switzerland", lat: 47.4, lng: 8.5, size: "large" },
    ];
    expect(searchAirports(list, "ZURICH", 5)).toHaveLength(1);
    expect(searchAirports(list, "zürich", 5)).toHaveLength(1);
  });

  it("respects the limit and returns nothing for empty or non-matching queries", () => {
    expect(codes("a", 3)).toHaveLength(3);
    expect(codes("   ")).toEqual([]);
    expect(codes("toronto", 0)).toEqual([]);
    expect(codes("qqqqzzzz")).toEqual([]);
  });

  it("does not repeat the exact match", () => {
    const found = codes("LHR", 20);
    expect(found.filter((c) => c === "LHR")).toHaveLength(1);
  });
});

describe("findAirport", () => {
  it("finds by code, ignoring case, and returns undefined for unknown codes", () => {
    expect(findAirport(AIRPORTS, "YYZ")?.city).toBe("Toronto");
    expect(findAirport(AIRPORTS, "yyz")?.iata).toBe("YYZ");
    expect(findAirport(AIRPORTS, "XXX")).toBeUndefined();
  });
});

describe("formatAirport", () => {
  it("shortens the official name and appends code and country", () => {
    expect(formatAirport({ iata: "YYZ", name: "Toronto Pearson International Airport", country: "Canada" })).toBe(
      "Toronto Pearson (YYZ), Canada",
    );
  });
});
