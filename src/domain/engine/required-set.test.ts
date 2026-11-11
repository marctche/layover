import { describe, expect, it } from "vitest";
import { triangleWithHomeLegs } from "../../../tests/helpers/builders";
import { money } from "../money/money";
import type { TripInput } from "../trip/types";
import { generateRouteOptions } from "./generate";
import { redactOptionsForViewer } from "./redact";

/** Three cities, 6 nights, 2 to 4 nights each: a 2-city route is feasible and saves one intercity leg. */
const required = (): TripInput => ({ ...triangleWithHomeLegs(), accepted: ["A", "B", "C"] });

/** 3 nights minimum in each city: all three cannot fit in 6 nights, any two can. */
const overfull = (): TripInput => {
  const t = required();
  t.cities = t.cities.map((c) => ({ ...c, minNights: 3 }));
  return t;
};

describe("required set", () => {
  it("never drops a required city, even when a shorter route is cheaper", () => {
    const optional = generateRouteOptions({ ...required(), accepted: [] });
    if (!optional.ok) throw new Error("expected ok");
    const cheapestOptional = optional.alternatives.find((a) => a.route.stops.length === 2);
    expect(cheapestOptional).toBeDefined(); // the shorter route exists and is cheaper

    const r = generateRouteOptions(required());
    if (!r.ok) throw new Error("expected ok");
    expect(r.alternatives.length).toBeGreaterThan(0);
    for (const a of r.alternatives) {
      expect(a.route.stops.map((s) => s.cityId).sort()).toEqual(["A", "B", "C"]);
      expect(a.route.metrics.groupTotal.amountMinor).toBeGreaterThan(cheapestOptional!.route.metrics.groupTotal.amountMinor);
    }
  });
});

describe("dropOptions on an infeasible required set", () => {
  it("offers each droppable city with feasible counts and a cheapest route", () => {
    const r = generateRouteOptions(overfull());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const err = r.errors[0]!;
    expect(err.code).toBe("no_feasible_route");
    const drops = err.dropOptions ?? [];
    expect(drops.map((d) => d.cityId)).toEqual(["A", "B", "C"]);
    for (const d of drops) {
      // Two remaining cities at 3 nights each, in either order.
      expect(d.feasibleCount).toBe(2);
      expect(d.cheapest?.stops.map((s) => s.cityId)).not.toContain(d.cityId);
      expect(d.cheapest?.stops).toHaveLength(2);
    }
  });

  it("excludes cities locked by an event, startCity, endCity or lockedOrder", () => {
    const withEvent: TripInput = {
      ...overfull(),
      fixedEvents: [{ id: "e", cityId: "C", startDate: "2027-06-04", endDate: "2027-06-04", label: "show" }],
    };
    const ids = (t: TripInput) => {
      const r = generateRouteOptions(t);
      if (r.ok) throw new Error("expected failure");
      return (r.errors[0]!.dropOptions ?? []).map((d) => d.cityId);
    };
    expect(ids(withEvent)).toEqual(["A", "B"]);
    expect(ids({ ...overfull(), startCity: "A" })).toEqual(["B", "C"]);
    expect(ids({ ...overfull(), endCity: "B" })).toEqual(["A", "C"]);
    expect(ids({ ...overfull(), lockedOrder: ["A", "C"] })).toEqual(["B"]);
  });

  it("excludes mustInclude cities but still offers merely accepted ones", () => {
    const r = generateRouteOptions({ ...overfull(), mustInclude: ["B"] });
    if (r.ok) throw new Error("expected failure");
    expect((r.errors[0]!.dropOptions ?? []).map((d) => d.cityId)).toEqual(["A", "C"]);
  });

  it("reports null cheapest and zero count when dropping a city does not help", () => {
    const t = overfull();
    t.legs = t.legs.filter((l) => !(l.from === "A" && l.to === "B") && !(l.from === "B" && l.to === "A"));
    const r = generateRouteOptions(t);
    if (r.ok) throw new Error("expected failure");
    const dropC = r.errors[0]!.dropOptions!.find((d) => d.cityId === "C")!;
    expect(dropC.feasibleCount).toBe(0);
    expect(dropC.cheapest).toBeNull();
  });
});

describe("redaction of dropOptions", () => {
  it("hides other travelers' headroom in dropOptions routes", () => {
    const t = overfull();
    t.travelers = [
      { id: "T", name: "Solo", home: "H", budgetCeiling: money(1_000_000, "CAD") },
      { id: "U", name: "Other", home: "H", budgetCeiling: money(2_000_000, "CAD") },
    ];
    const raw = generateRouteOptions(t);
    if (raw.ok) throw new Error("expected failure");
    const rawCheapest = raw.errors[0]!.dropOptions![0]!.cheapest!;
    expect(rawCheapest.travelerCosts.every((c) => c.headroom !== undefined)).toBe(true);

    const red = redactOptionsForViewer(raw, "T");
    if (red.ok) throw new Error("expected failure");
    for (const d of red.errors[0]!.dropOptions!) {
      const costs = d.cheapest!.travelerCosts;
      expect(costs.find((c) => c.travelerId === "T")?.headroom).toBeDefined();
      expect(costs.find((c) => c.travelerId === "U")?.headroom).toBeUndefined();
    }
  });
});
