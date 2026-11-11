import { describe, expect, it } from "vitest";
import { computeReadiness, tripNights, type ReadinessInput } from "./readiness";

const base: ReadinessInput = {
  startDate: "2027-03-01",
  endDate: "2027-03-15",
  departureAirport: "YYZ",
  cityCount: 3,
  ratedCountByMember: [
    { userId: "a", name: "Alex", rated: 3 },
    { userId: "b", name: "Sam", rated: 1 },
  ],
  viewerId: "a",
  hasMyBudget: true,
};

describe("tripNights", () => {
  it("counts nights between date-only strings", () => {
    expect(tripNights("2027-03-01", "2027-03-15")).toBe(14);
    expect(tripNights("2027-02-27", "2027-03-02")).toBe(3);
  });
  it("is null when missing, invalid or reversed", () => {
    expect(tripNights(null, "2027-03-15")).toBeNull();
    expect(tripNights("2027-02-30", "2027-03-15")).toBeNull();
    expect(tripNights("2027-03-15", "2027-03-01")).toBeNull();
  });
});

describe("computeReadiness", () => {
  it("has no blockers when the shared setup is complete", () => {
    const r = computeReadiness(base);
    expect(r.blockers).toEqual([]);
    expect(r.items.every((i) => i.done)).toBe(true);
    expect(r.members).toEqual([
      { userId: "a", name: "Alex", rated: 3, total: 3, complete: true },
      { userId: "b", name: "Sam", rated: 1, total: 3, complete: false },
    ]);
  });

  it("names each missing required item", () => {
    const r = computeReadiness({ ...base, startDate: null, endDate: null, departureAirport: null, cityCount: 1 });
    expect(r.blockers).toHaveLength(3);
    expect(r.blockers[0]).toContain("exact start and end dates");
    expect(r.blockers[1]).toContain("airport");
    expect(r.blockers[2]).toBe("1 of 8 added");
  });

  it("does not block on your own unfinished part", () => {
    const r = computeReadiness({ ...base, hasMyBudget: false, viewerId: "b" });
    expect(r.blockers).toEqual([]);
    expect(r.items.filter((i) => !i.done).map((i) => i.id)).toEqual(["myRatings", "myBudget"]);
  });

  it("points each item at its setup step", () => {
    const r = computeReadiness({ ...base, viewerId: "b" });
    expect(Object.fromEntries(r.items.map((i) => [i.id, i.step]))).toEqual({
      dates: "dates",
      airport: "airport",
      cities: "cities",
      myRatings: "rate",
      myBudget: "budget",
    });
  });

  it("has no availability item", () => {
    expect(computeReadiness(base).items.map((i) => i.id)).not.toContain("myAvailability");
  });

  it("treats zero-night dates and more than 8 cities as not ready", () => {
    expect(computeReadiness({ ...base, endDate: base.startDate }).items[0]?.done).toBe(false);
    expect(computeReadiness({ ...base, cityCount: 9 }).blockers[0]).toContain("limit is 8");
  });
});
