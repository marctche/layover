import { describe, expect, it } from "vitest";
import { asiaDemo } from "../../../tests/fixtures/asia-demo";
import { miniTrip } from "../../../tests/helpers/builders";
import { money } from "../money/money";
import { redactForViewer, redactOptionsForViewer, redactSimulationForViewer } from "./redact";
import { simulateChange } from "./simulate";
import { generateRouteOptions } from "./generate";
import type { TripInput } from "../trip/types";

function withCeiling(input: TripInput, travelerId: string, cents: number): TripInput {
  return {
    ...input,
    travelers: input.travelers.map((t) => (t.id === travelerId ? { ...t, budgetCeiling: money(cents, input.currency) } : t)),
  };
}

describe("budgets are hard", () => {
  it("accepts a total exactly at the ceiling and rejects one cent under it", () => {
    const at = generateRouteOptions(withCeiling(miniTrip(), "T2", 193_000));
    expect(at.ok).toBe(true);
    if (at.ok) expect(at.alternatives[0]?.route.travelerCosts[1]?.headroom?.amountMinor).toBe(0);

    const under = generateRouteOptions(withCeiling(miniTrip(), "T2", 192_999));
    expect(under.ok).toBe(false);
    if (under.ok) return;
    expect(under.errors[0]?.code).toBe("no_feasible_route");
    expect(under.errors[0]?.rejections?.over_budget).toBe(1);
  });

  it("removes routes when one traveler's ceiling drops", () => {
    const loose = generateRouteOptions(asiaDemo);
    const tight = generateRouteOptions(withCeiling(asiaDemo, "bea", 440_000));
    if (!loose.ok || !tight.ok) throw new Error("expected both feasible");
    expect(tight.feasibleCount).toBeLessThan(loose.feasibleCount);
    expect(tight.rejections.over_budget).toBeGreaterThan(loose.rejections.over_budget);
  });

  it("exposes only a count in the rejection summary", () => {
    const r = generateRouteOptions(withCeiling(asiaDemo, "bea", 440_000));
    if (!r.ok) throw new Error("expected ok");
    expect(Object.keys(r.rejections).sort()).toEqual(
      ["min_nights_exceeded", "missing_home_leg", "missing_leg", "no_valid_allocation", "over_budget", "order_locked"].sort(),
    );
    const text = JSON.stringify(r.rejections);
    for (const t of asiaDemo.travelers) expect(text).not.toContain(t.id);
    expect(text).not.toContain("440000");
    expect(Object.values(r.rejections).every((n) => Number.isInteger(n))).toBe(true);
  });

  it("puts each traveler's headroom only in their own entry", () => {
    const input = withCeiling(miniTrip(), "T1", 200_000);
    const r = generateRouteOptions(input);
    if (!r.ok) throw new Error("expected ok");
    const [t1, t2] = r.alternatives[0]!.route.travelerCosts;
    expect(t1?.headroom?.amountMinor).toBe(200_000 - 171_000);
    expect(t2).not.toHaveProperty("headroom");
    expect(JSON.stringify(t2)).not.toContain("200000");
  });

  it("redactForViewer strips everyone else's headroom", () => {
    const input = withCeiling(withCeiling(miniTrip(), "T1", 200_000), "T2", 250_000);
    const r = generateRouteOptions(input);
    if (!r.ok) throw new Error("expected ok");
    const view = redactForViewer(r.alternatives[0]!.route, "T2");
    expect(view.travelerCosts[0]).not.toHaveProperty("headroom");
    expect(view.travelerCosts[1]?.headroom?.amountMinor).toBe(250_000 - 193_000);
  });

  // Walks any serialized result and returns every travelerCosts entry in it.
  function allCosts(value: unknown): { travelerId: string; headroom?: unknown }[] {
    const found: { travelerId: string; headroom?: unknown }[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        for (const [k, child] of Object.entries(v)) {
          if (k === "travelerCosts" && Array.isArray(child)) found.push(...child);
          walk(child);
        }
      }
    };
    walk(JSON.parse(JSON.stringify(value)));
    return found;
  }

  const ceilings = (input: TripInput) =>
    input.travelers.reduce((acc, t, i) => withCeiling(acc, t.id, 900_000 + i * 1_000), input);

  it("redactOptionsForViewer leaves only the viewer's headroom in every alternative", () => {
    const r = generateRouteOptions(ceilings(asiaDemo));
    if (!r.ok) throw new Error("expected ok");
    expect(r.alternatives.length).toBeGreaterThan(1);
    const costs = allCosts(redactOptionsForViewer(r, "bea"));
    expect(costs.length).toBe(r.alternatives.length * asiaDemo.travelers.length);
    for (const c of costs) {
      if (c.travelerId === "bea") expect(c).toHaveProperty("headroom");
      else expect(c).not.toHaveProperty("headroom");
    }
  });

  it("redactSimulationForViewer covers both sides of every objective", () => {
    const r = simulateChange(ceilings(asiaDemo), { type: "remove", cityId: "seoul" });
    if (!r.ok) throw new Error("expected ok");
    const raw = allCosts(r);
    expect(raw.some((c) => c.travelerId !== "bea" && "headroom" in c)).toBe(true);
    const costs = allCosts(redactSimulationForViewer(r, "bea"));
    expect(costs.length).toBe(raw.length);
    for (const c of costs) {
      if (c.travelerId === "bea") expect(c).toHaveProperty("headroom");
      else expect(c).not.toHaveProperty("headroom");
    }
  });
});
