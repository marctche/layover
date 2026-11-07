import { describe, expect, it } from "vitest";
import { chainTrip, triangleWithHomeLegs } from "../../../tests/helpers/builders";
import type { TripInput } from "../trip/types";
import { searchRoutes } from "./route-search";
import { simulateChange } from "./simulate";
import { validateInput } from "./validate";

// triangleWithHomeLegs: cities A, B, C (2..4 nights each), 6 nights, one traveler,
// every pair connected both ways, home legs to and from every city. Any ordered
// subset of 2 or 3 cities with enough nights is feasible: 2 cities split 6 nights
// (2..4 each), 3 cities get exactly 2 each.
const ids = (input: TripInput) =>
  searchRoutes(input)
    .routes.map((r) => r.id)
    .sort();
const orders = (...seqs: string[][]) => seqs.map((s) => JSON.stringify(s)).sort();

describe("lockedOrder", () => {
  it("never yields a route with A before C when [C, A] is locked", () => {
    const input = { ...triangleWithHomeLegs(), lockedOrder: ["C", "A"] };
    const { routes, rejections } = searchRoutes(input);
    // Both C and A are required; B optional and may sit anywhere that keeps C before A.
    expect(routes.map((r) => r.id).sort()).toEqual(orders(["C", "A"], ["C", "B", "A"], ["B", "C", "A"], ["C", "A", "B"]));
    for (const r of routes) {
      expect(r.metrics.citiesIncluded.indexOf("C")).toBeLessThan(r.metrics.citiesIncluded.indexOf("A"));
    }
    expect(rejections.order_locked).toBeGreaterThan(0);
  });

  it("without a lock the same trip has the reversed orders too", () => {
    const input = { ...triangleWithHomeLegs(), mustInclude: ["C", "A"] };
    expect(ids(input)).toHaveLength(8); // 2 two-city orders + 6 three-city orders
  });
});

describe("startCity and endCity", () => {
  it("startCity forces the first stop and is required", () => {
    const input = { ...triangleWithHomeLegs(), startCity: "B" };
    // B>A, B>C, B>A>C, B>C>A. "B" alone fails on nights (6 > max 4).
    expect(ids(input)).toEqual(orders(["B", "A"], ["B", "C"], ["B", "A", "C"], ["B", "C", "A"]));
  });

  it("endCity forces the last stop and is required", () => {
    const input = { ...triangleWithHomeLegs(), endCity: "A" };
    expect(ids(input)).toEqual(orders(["B", "A"], ["C", "A"], ["B", "C", "A"], ["C", "B", "A"]));
  });

  it("startCity, endCity and lockedOrder together leave exactly one order", () => {
    const input = { ...triangleWithHomeLegs(), startCity: "B", endCity: "A", lockedOrder: ["C", "A"] };
    expect(validateInput(input)).toEqual([]);
    // B first, A last, C before A: only B>C>A.
    expect(ids(input)).toEqual(orders(["B", "C", "A"]));
  });

  it("does not change what a surviving sequence costs", () => {
    // B>C>A is 2+2+2 nights: 6 * (80 + 50) = 780 + intercity 2 * 100 + home legs 400 + 400 = 1780.00.
    const free = searchRoutes({ ...triangleWithHomeLegs(), mustInclude: ["A", "B", "C"] }).routes.find((r) => r.id === JSON.stringify(["B", "C", "A"]));
    const locked = searchRoutes({ ...triangleWithHomeLegs(), startCity: "B", endCity: "A", lockedOrder: ["C", "A"] }).routes[0];
    expect(locked?.travelerCosts[0]?.total.amountMinor).toBe(178_000);
    expect(free?.travelerCosts).toEqual(locked?.travelerCosts);
  });
});

describe("lock validation", () => {
  const codes = (input: TripInput) => validateInput(input).map((e) => [e.code, e.path]);
  const base = triangleWithHomeLegs();

  it("rejects unknown ids", () => {
    expect(codes({ ...base, lockedOrder: ["A", "Z"] })).toEqual([["unknown_city", "lockedOrder[1]"]]);
    expect(codes({ ...base, startCity: "Z" })).toEqual([["unknown_city", "startCity"]]);
    expect(codes({ ...base, endCity: "Z" })).toEqual([["unknown_city", "endCity"]]);
  });

  it("rejects duplicate ids inside lockedOrder", () => {
    expect(codes({ ...base, lockedOrder: ["A", "B", "A"] })).toEqual([["duplicate_id", "lockedOrder[2]"]]);
  });

  it("rejects startCity equal to endCity with more than one city, with a clear message", () => {
    const errors = validateInput({ ...base, startCity: "A", endCity: "A" });
    expect(errors.map((e) => [e.code, e.path])).toEqual([["invalid_option", "endCity"]]);
    expect(errors[0]!.message).toMatch(/cannot begin and end in the same city/);
  });

  it("allows startCity equal to endCity when there is a single city", () => {
    const single = { ...base, cities: [base.cities[0]!], cityCosts: [base.cityCosts[0]!], legs: base.legs.filter((l) => l.from === "H" || l.to === "H").filter((l) => l.from === "A" || l.to === "A") };
    expect(validateInput({ ...single, startCity: "A", endCity: "A" })).toEqual([]);
  });

  it("rejects startCity in lockedOrder that is not first, and endCity that is not last", () => {
    expect(codes({ ...base, lockedOrder: ["A", "B"], startCity: "B" })).toEqual([["invalid_option", "startCity"]]);
    expect(codes({ ...base, lockedOrder: ["A", "B"], endCity: "A" })).toEqual([["invalid_option", "endCity"]]);
    expect(codes({ ...base, lockedOrder: ["A", "B"], startCity: "A", endCity: "B" })).toEqual([]);
  });
});

describe("simulate with locks", () => {
  const cases: [string, Partial<TripInput>, string][] = [
    ["lockedOrder", { lockedOrder: ["B", "A"] }, "lockedOrder"],
    ["startCity", { startCity: "A" }, "startCity"],
    ["endCity", { endCity: "A" }, "endCity"],
  ];
  it.each(cases)("refuses to remove a city held by %s", (_n, lock, word) => {
    const input: TripInput = { ...triangleWithHomeLegs(), ...lock };
    const r = simulateChange(input, { type: "remove", cityId: "A" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.code).toBe("city_required");
    expect(r.errors[0]?.message).toContain(word);
  });

  it("still allows removing an unlocked city while locks apply", () => {
    // Lock A then C; B is free. Removing B leaves only A>C-type routes with A before C.
    const input: TripInput = { ...triangleWithHomeLegs(), lockedOrder: ["A", "C"] };
    const r = simulateChange(input, { type: "remove", cityId: "B" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.proposedFeasibleCount).toBe(1);
  });

  it("is unaffected on trips without locks", () => {
    expect(simulateChange(chainTrip(), { type: "remove", cityId: "C" }).ok).toBe(true);
  });
});
