import { describe, expect, it } from "vitest";
import { miniTrip } from "../../../tests/helpers/builders";
import { generateRouteOptions } from "./generate";
import { sortSources, VETO_PENALTY } from "./costs";

describe("per-traveler costs", () => {
  it("matches a hand computation to the cent", () => {
    // A 3 nights, B 2 nights (A has the higher group weight, so it takes the spare night).
    const r = generateRouteOptions(miniTrip());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const route = r.alternatives[0]!.route;
    const [t1, t2] = route.travelerCosts;

    expect(t1).toMatchObject({
      travelerId: "T1",
      international: { amountMinor: 50_000 + 52_000 },
      intercity: { amountMinor: 10_000 },
      lodging: { amountMinor: 3 * 8_000 + 2 * 6_000 },
      daily: { amountMinor: 3 * 5_000 + 2 * 4_000 },
      total: { amountMinor: 171_000 },
      priceSources: ["synthetic"],
    });
    expect(t2).toMatchObject({
      international: { amountMinor: 60_000 + 64_000 },
      intercity: { amountMinor: 10_000 },
      lodging: { amountMinor: 36_000 },
      daily: { amountMinor: 23_000 },
      total: { amountMinor: 193_000 },
    });
    expect(route.metrics.groupTotal.amountMinor).toBe(364_000);
    expect(route.metrics.totalCostPerTraveler.map((c) => c.total.amountMinor)).toEqual([171_000, 193_000]);
  });

  it("computes travel minutes, transfers, cities and satisfaction", () => {
    const r = generateRouteOptions(miniTrip());
    if (!r.ok) throw new Error("expected ok");
    const m = r.alternatives[0]!.route.metrics;
    // 60 intercity + mean of (600+620) and (700+720) = 1320.
    expect(m.totalTravelMinutes).toBe(60 + 1320);
    expect(m.transfers).toBe(1);
    expect(m.citiesIncluded).toEqual(["A", "B"]);
    expect(m.citiesExcluded).toEqual([]);
    expect(m.priceSources).toEqual(["synthetic"]);
    // T1: 2*3 + (-2*2 - veto) ; T2: 1*3 + 1*2.
    expect(m.satisfaction).toBe(2 * 3 - 2 * 2 - VETO_PENALTY + 3 + 2);
  });
});

describe("sortSources", () => {
  it("keeps every distinct source, most trustworthy first", () => {
    expect(sortSources(["synthetic", "live", "estimate", "live", "manual"])).toEqual(["live", "manual", "estimate", "synthetic"]);
  });
});
