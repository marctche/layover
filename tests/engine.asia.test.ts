import { describe, expect, it } from "vitest";
import { generateRouteOptions } from "@/domain";
import { asiaDemo } from "./fixtures/asia-demo";

function run() {
  const r = generateRouteOptions(asiaDemo);
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.errors)}`);
  return r;
}

describe("Asia demo fixture", () => {
  it("returns at least two alternatives", () => {
    expect(run().alternatives.length).toBeGreaterThanOrEqual(2);
  });

  it("puts the group in Hong Kong on the night of 2027-06-12 in every alternative", () => {
    for (const { route } of run().alternatives) {
      const hk = route.stops.find((s) => s.cityId === "hongkong");
      expect(hk, route.id).toBeDefined();
      expect(hk!.checkIn <= "2027-06-12" && "2027-06-12" < hk!.checkOut, route.id).toBe(true);
    }
  });

  it("keeps every traveler within their own ceiling", () => {
    for (const { route } of run().alternatives) {
      for (const t of asiaDemo.travelers) {
        const cost = route.travelerCosts.find((c) => c.travelerId === t.id)!;
        expect(cost.total.amountMinor).toBeLessThanOrEqual(t.budgetCeiling!.amountMinor);
        expect(cost.headroom?.amountMinor).toBe(t.budgetCeiling!.amountMinor - cost.total.amountMinor);
      }
    }
  });

  it("allocates exactly the trip's 14 nights and only uses synthetic prices", () => {
    for (const { route } of run().alternatives) {
      expect(route.stops.reduce((n, s) => n + s.nights, 0)).toBe(14);
      expect(route.metrics.priceSources).toEqual(["synthetic"]);
    }
  });

  it("never routes through a missing leg", () => {
    for (const { route } of run().alternatives) {
      for (const l of route.intercityLegs) expect(`${l.from}>${l.to}`).not.toMatch(/tokyo>(chongqing|shenzhen)|(chongqing|shenzhen)>tokyo/);
    }
  });

  it("is deterministic", () => {
    expect(run()).toEqual(run());
  });
});
