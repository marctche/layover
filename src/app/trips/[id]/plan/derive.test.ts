import { describe, expect, it } from "vitest";
import type { PlanView } from "@/server";
import { planProgress } from "./derive";

const me = "u1";
const view = (over: Partial<PlanView> = {}): PlanView => ({
  trip: { id: "t", name: "Asia", startDate: "2027-03-01", endDate: "2027-03-08", status: "planning", groupTargetMinor: null, baseCurrency: "USD" },
  viewerRole: "member",
  members: [
    { userId: me, role: "member", displayName: "Me", homeAirport: null },
    { userId: "u2", role: "coordinator", displayName: "", homeAirport: null },
  ],
  destinations: [
    { id: "d1", name: "Tokyo, Japan", suggestedBy: "u2" },
    { id: "d2", name: "Seoul, South Korea", suggestedBy: "u2" },
  ],
  preferences: [{ destinationId: "d1", userId: me, score: 2 }],
  myBudget: null,
  constraints: { departureAirport: "YYZ", startDestinationId: null, endDestinationId: null, earliestStart: null, latestEnd: null, minNights: null, maxNights: null },
  destinationConstraints: [],
  fixedEvents: [],
  myAvailability: { userId: me, flexibilityDays: 0, ranges: [] },
  ...over,
});

describe("planProgress", () => {
  it("marks shared steps from the saved rows and my steps from my rows", () => {
    const p = planProgress(view(), me);
    expect(p.nights).toBe(7);
    expect(p.done).toMatchObject({ when: true, from: true, where: true, rules: false, rate: false, free: false, budget: false, ready: true });
    expect(p.readiness.members.map((m) => [m.name, m.rated])).toEqual([["Me", 1], ["Unnamed traveler", 0]]);
  });

  it("counts ratings only for cities that exist, and treats no ranges as not set", () => {
    const p = planProgress(
      view({ preferences: [{ destinationId: "gone", userId: me, score: 1 }, { destinationId: "d1", userId: me, score: 1 }, { destinationId: "d2", userId: me, score: 1 }] }),
      me,
    );
    expect(p.done.rate).toBe(true);
    expect(p.done.free).toBe(false);
  });

  it("is not ready without dates, and a must-visit city counts as rules set", () => {
    const p = planProgress(view({ trip: { ...view().trip, startDate: null, endDate: null }, destinationConstraints: [{ destinationId: "d1", minNights: 1, maxNights: null, mustInclude: true, lockPosition: null }] }), me);
    expect(p.done.ready).toBe(false);
    expect(p.done.rules).toBe(true);
  });
});
