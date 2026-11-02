import { describe, expect, it } from "vitest";
import { generateRouteOptions } from "@/domain";
import type { TripInput } from "@/domain";
import { leg, quote } from "./helpers/builders";

// Worst case at the cap: 8 cities, every pair connected, every city reachable from home.
function fullyConnected(n: number, nights: number): TripInput {
  const ids = Array.from({ length: n }, (_, i) => `C${i}`);
  const legs = ids.flatMap((a, i) => [
    leg("H", a, 600, 900 + i * 10),
    leg(a, "H", 600, 900 + i * 10),
    ...ids.filter((b) => b !== a).map((b, j) => leg(a, b, 90 + j * 5, 80 + j * 7)),
  ]);
  return {
    currency: "CAD",
    startDate: "2027-06-01",
    endDate: `2027-06-${String(1 + nights).padStart(2, "0")}`,
    cities: ids.map((id) => ({ id, name: id, minNights: 1, maxNights: 5 })),
    travelers: [{ id: "T", name: "T", home: "H" }],
    legs,
    cityCosts: ids.map((id) => ({ cityId: id, lodgingPerPersonPerNight: quote(100), dailySpendPerPerson: quote(50) })),
    fixedEvents: [],
    preferences: ids.map((id, i) => ({ travelerId: "T", cityId: id, score: ((i % 5) - 2) as -2 | -1 | 0 | 1 | 2 })),
  };
}

describe("worst case at the city cap", () => {
  it("8 fully connected cities over 21 nights finishes", () => {
    const t0 = performance.now();
    const r = generateRouteOptions(fullyConnected(8, 21));
    const ms = performance.now() - t0;
    console.log(`8 cities, 21 nights: ${ms.toFixed(0)} ms, ok=${r.ok}`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    console.log(`stats: ${JSON.stringify(r.stats)}`);
    // Deterministic guard: allocation runs must be far fewer than orderings evaluated.
    expect(r.stats.sequencesEvaluated).toBeGreaterThan(50_000);
    expect(r.stats.allocationRuns * 100).toBeLessThan(r.stats.sequencesEvaluated);
  }, 120_000);
});
