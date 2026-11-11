import { describe, expect, it } from "vitest";
import { money } from "../money/money";
import { paretoFront, pickAlternatives } from "./select";
import type { RoutePlan } from "./types";

function plan(id: string, dollars: number, minutes: number, satisfaction: number): RoutePlan {
  const cityIds = id.split(">");
  return {
    id,
    stops: cityIds.map((cityId, i) => ({ cityId, nights: 2, firstNight: i * 2, checkIn: "", checkOut: "" })),
    intercityLegs: [],
    travelerCosts: [],
    metrics: {
      totalCostPerTraveler: [],
      groupTotal: money(dollars * 100, "CAD"),
      totalTravelMinutes: minutes,
      transfers: cityIds.length - 1,
      satisfaction,
      citiesIncluded: cityIds,
      citiesExcluded: [],
      estimatedLegs: [],
      priceSources: ["synthetic"],
    },
  };
}

describe("paretoFront", () => {
  const cheap = plan("A>B", 1000, 600, 5);
  const wanted = plan("A>C", 2000, 700, 20);
  const fast = plan("B>C", 1500, 100, 8);
  const dominated = plan("C>B", 2500, 800, 1);

  it("drops dominated routes and keeps trade-offs", () => {
    const front = paretoFront([dominated, cheap, wanted, fast]);
    expect(front.map((r) => r.id).sort()).toEqual(["A>B", "A>C", "B>C"]);
  });

  it("keeps routes that tie on every metric", () => {
    const twin = plan("B>A", 1000, 600, 5);
    expect(paretoFront([cheap, twin])).toHaveLength(2);
  });
});

describe("pickAlternatives", () => {
  it("labels cheapest, most_wanted and least_travel as different routes", () => {
    const front = paretoFront([plan("A>B", 1000, 600, 5), plan("A>C", 2000, 700, 20), plan("B>C", 1500, 100, 8)]);
    const picks = pickAlternatives(front, 3);
    const byLabel = Object.fromEntries(picks.flatMap((p) => p.labels.map((l) => [l, p.route.id])));
    expect(byLabel).toEqual({ cheapest: "A>B", most_wanted: "A>C", least_travel: "B>C" });
  });

  it("dedupes when one route wins every label and fills with other Pareto routes", () => {
    const best = plan("A>B", 100, 10, 50);
    expect(pickAlternatives(paretoFront([best, plan("A>C", 200, 20, 10)]), 3)).toEqual([
      { route: best, labels: ["cheapest", "most_wanted", "least_travel"] },
    ]);
  });

  it("fills spare slots with a different Pareto route", () => {
    const front = paretoFront([
      plan("A>B", 100, 10, 50),
      plan("A>B>C", 90, 30, 40),
      plan("D>E", 120, 5, 45),
      plan("A>D", 110, 20, 60),
      plan("A>E", 105, 15, 55),
    ]);
    const picks = pickAlternatives(front, 5);
    expect(new Set(picks.map((p) => p.route.id)).size).toBe(picks.length);
    expect(picks.some((p) => p.labels.includes("pareto_alternative"))).toBe(true);
  });

  it("honours maxAlternatives", () => {
    const front = paretoFront([plan("A>B", 1000, 600, 5), plan("A>C", 2000, 700, 20), plan("B>C", 1500, 100, 8)]);
    expect(pickAlternatives(front, 2)).toHaveLength(2);
  });
});
