import { describe, expect, it } from "vitest";
import { asiaDemo } from "../../../tests/fixtures/asia-demo";
import { chainTrip } from "../../../tests/helpers/builders";
import type { TripInput } from "../trip/types";
import { compareRoutes } from "./compare";
import { generateRouteOptions } from "./generate";
import { simulateChange, withoutCity } from "./simulate";

describe("simulateChange", () => {
  it("adding a city has a positive marginal cost, hand-checked", () => {
    const r = simulateChange(chainTrip(), { type: "add", cityId: "C" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cheapest = r.outcomes.find((o) => o.objective === "cheapest")!;
    expect(cheapest.baseline?.id).toBe(JSON.stringify(["A", "B"]));
    expect(cheapest.proposed?.id).toBe(JSON.stringify(["A", "B", "C"]));
    expect(cheapest.baseline?.metrics.groupTotal.amountMinor).toBe(166_000);
    expect(cheapest.proposed?.metrics.groupTotal.amountMinor).toBe(176_000);

    const c = cheapest.comparison!;
    expect(c.groupTotalDelta.amountMinor).toBe(10_000);
    expect(c.travelerDeltas[0]?.delta).toMatchObject({
      international: { amountMinor: 3_000 },
      intercity: { amountMinor: 15_000 },
      lodging: { amountMinor: -4_000 },
      daily: { amountMinor: -4_000 },
      total: { amountMinor: 10_000 },
    });
    expect(c.travelMinutesDelta).toBe(100);
    expect(c.transfersDelta).toBe(1);
    expect(c.citiesAdded).toEqual(["C"]);
    expect(c.citiesRemoved).toEqual([]);
    expect(c.nightsByCity).toEqual([
      { cityId: "A", from: 4, to: 2, delta: -2 },
      { cityId: "B", from: 2, to: 2, delta: 0 },
      { cityId: "C", from: 0, to: 2, delta: 2 },
    ]);
  });

  it("remove is the mirror of add", () => {
    const r = simulateChange(chainTrip(), { type: "remove", cityId: "C" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.outcomes[0]?.baseline?.id).toBe(JSON.stringify(["A", "B", "C"]));
    expect(r.outcomes[0]?.comparison?.groupTotalDelta.amountMinor).toBe(-10_000);
  });

  it("refuses to remove the Hong Kong event city and says why", () => {
    const r = simulateChange(asiaDemo, { type: "remove", cityId: "hongkong" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.code).toBe("city_required");
    expect(r.errors[0]?.message).toContain("Concert in Hong Kong");
  });

  it("refuses to remove a mustInclude city", () => {
    const r = simulateChange(chainTrip(), { type: "remove", cityId: "A" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.message).toContain("mustInclude");
  });

  it("removes a merely accepted city and compares against keeping it", () => {
    const input = { ...chainTrip(), mustInclude: ["A"], accepted: ["A", "B", "C"] };
    const r = simulateChange(input, { type: "remove", cityId: "C" });
    if (!r.ok) throw new Error("expected ok");
    const cheapest = r.outcomes.find((o) => o.objective === "cheapest")!;
    expect(cheapest.baseline?.id).toBe(JSON.stringify(["A", "B", "C"]));
    expect(cheapest.proposed?.stops.map((s) => s.cityId)).not.toContain("C");
    expect(cheapest.comparison?.groupTotalDelta.amountMinor).toBe(-10_000);
    expect(cheapest.comparison?.citiesRemoved).toEqual(["C"]);
  });

  it("withoutCity also drops the city from accepted", () => {
    const out = withoutCity({ ...chainTrip(), accepted: ["A", "B", "C"] }, "C");
    expect(out.accepted).toEqual(["A", "B"]);
  });

  it("still refuses to remove an event, lock, start or end city when accepted", () => {
    const accepted = ["A", "B", "C"];
    const base: TripInput = { ...chainTrip(), mustInclude: [], accepted };
    const refused = (input: TripInput, cityId: string) => {
      const r = simulateChange(input, { type: "remove", cityId });
      return !r.ok && r.errors[0]?.code === "city_required";
    };
    expect(refused({ ...base, fixedEvents: [{ id: "e", cityId: "B", startDate: "2027-06-02", endDate: "2027-06-02", label: "x" }] }, "B")).toBe(true);
    expect(refused({ ...base, lockedOrder: ["B"] }, "B")).toBe(true);
    expect(refused({ ...base, startCity: "A" }, "A")).toBe(true);
    expect(refused({ ...base, endCity: "C" }, "C")).toBe(true);
    expect(refused({ ...base, mustInclude: ["B"] }, "B")).toBe(true);
  });

  it("rejects an unknown city", () => {
    const r = simulateChange(chainTrip(), { type: "add", cityId: "ZZ" });
    expect(r.ok).toBe(false);
  });

  it("reports null sides instead of inventing a route when a side is infeasible", () => {
    const input = chainTrip();
    input.legs = input.legs.filter((l) => !(l.from === "B" && l.to === "C"));
    const r = simulateChange(input, { type: "add", cityId: "C" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.proposedFeasibleCount).toBe(0);
    expect(r.outcomes.every((o) => o.proposed === null && o.comparison === null)).toBe(true);
  });
});

describe("compareRoutes", () => {
  it("derives every delta from the two plans", () => {
    const sim = simulateChange(chainTrip(), { type: "add", cityId: "C" });
    if (!sim.ok) throw new Error("expected ok");
    const x = sim.outcomes[0]!.baseline!;
    const y = sim.outcomes[0]!.proposed!;
    const r = compareRoutes(x, y);
    if (!r.ok) throw new Error("expected ok");
    expect(r.comparison.groupTotalDelta.amountMinor).toBe(y.metrics.groupTotal.amountMinor - x.metrics.groupTotal.amountMinor);
    expect(r.comparison.travelMinutesDelta).toBe(y.metrics.totalTravelMinutes - x.metrics.totalTravelMinutes);
    expect(r.comparison.fromId).toBe(JSON.stringify(["A", "B"]));
    expect(r.comparison.toId).toBe(JSON.stringify(["A", "B", "C"]));
  });

  it("refuses plans for different travelers", () => {
    const a = generateRouteOptions(chainTrip());
    if (!a.ok) throw new Error("expected ok");
    const route = a.alternatives[0]!.route;
    const other = { ...route, travelerCosts: route.travelerCosts.map((c) => ({ ...c, travelerId: "other" })) };
    const r = compareRoutes(route, other);
    expect(r.ok).toBe(false);
  });
});
