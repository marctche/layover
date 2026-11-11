import { describe, expect, it } from "vitest";
import airportData from "@/data/airports.json";
import { SEARCH_HUB_TIER } from "./hubs";
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

  it("puts major hubs first for big-city queries", () => {
    expect(codes("london")[0]).toBe("LHR");
    expect(codes("new york")[0]).toBe("JFK");
    expect(codes("tokyo").slice(0, 2).sort()).toEqual(["HND", "NRT"]);
    const paris = codes("paris");
    expect(paris.indexOf("CDG")).toBeGreaterThanOrEqual(0);
    expect(paris.indexOf("CDG")).toBeLessThan(paris.indexOf("ORY"));
    const toronto = codes("toronto");
    expect(toronto.indexOf("YYZ")).toBeLessThan(toronto.indexOf("YTZ"));
  });

  it("orders unlisted airports with large before medium, then catalog order", () => {
    const mk = (iata: string, size: Airport["size"]): Airport => ({ iata, name: `Test ${iata}`, city: "Testville", country: "Nowhere", lat: 0, lng: 0, size });
    const list = [mk("QMA", "medium"), mk("QLA", "large"), mk("QLB", "large")];
    expect(searchAirports(list, "testville", 5).map((a) => a.iata)).toEqual(["QLA", "QLB", "QMA"]);
  });

  it("keeps an exact code first even when a hub matches the same text", () => {
    expect(codes("lhr")[0]).toBe("LHR");
    expect(codes("nrt")[0]).toBe("NRT");
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

describe("search hub list", () => {
  it("only names airports that exist in the catalog", () => {
    const known = new Set(AIRPORTS.map((a) => a.iata));
    for (const code of Object.keys(SEARCH_HUB_TIER)) expect(known.has(code), code).toBe(true);
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
