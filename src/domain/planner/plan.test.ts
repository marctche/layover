import { describe, expect, it } from "vitest";
import { asiaDryRun, europeDryRun } from "./catalog";
import { synthCity, synthInput } from "./fixtures";
import { planSearches } from "./plan";
import type { PlannedSearch, SearchPlan } from "./types";

function ok(plan: SearchPlan) {
  if (!plan.ok) throw new Error(`plan failed: ${JSON.stringify(plan.errors)}`);
  return plan;
}
const kind = (searches: PlannedSearch[], k: PlannedSearch["kind"]) => searches.filter((s) => s.kind === k);

describe("planSearches: europeDryRun", () => {
  const plan = ok(planSearches(europeDryRun));

  it("has one open-jaw per distinct (first,last) pair: 6 for 3 cities", () => {
    const pairs = new Set(plan.keptOrders.map((k) => `${k.order[0]}>${k.order.at(-1)}`));
    expect(pairs.size).toBe(6);
    expect(kind(plan.searches, "open_jaw")).toHaveLength(6);
  });

  it("has 6 intercity one-way searches", () => {
    const oneWays = kind(plan.searches, "one_way");
    expect(oneWays).toHaveLength(6);
    expect(oneWays.every((s) => s.purpose === "intercity")).toBe(true);
  });

  it("searches all home airports together on the exact trip dates", () => {
    for (const s of kind(plan.searches, "open_jaw")) {
      expect(s.legs).toHaveLength(2);
      expect(s.legs[0]!.from).toEqual(["YOW", "YYZ", "YUL"]);
      expect(s.legs[0]!.date).toBe("2026-12-10");
      expect(s.legs[1]!.to).toEqual(["YOW", "YYZ", "YUL"]);
      expect(s.legs[1]!.date).toBe("2026-12-23");
    }
  });

  it("estimates every intercity date at night 7 (2026-12-17)", () => {
    // 13 nights. Pair a>b has three estimates: position 0 of a>b>c is round(13*1/3)=4,
    // position 1 of c>a>b is round(13*2/3)=9, and the contraction a>c>b minus c is a
    // 2-stop route with round(13*1/2)=7 (6.5 rounds up). Lower median of [4,7,9] = 7.
    for (const s of kind(plan.searches, "one_way")) expect(s.legs[0]!.date).toBe("2026-12-17");
  });

  it("bills 6 open-jaws at 2 plus 6 one-ways at 1", () => {
    // 6 * 2 + 6 * 1 = 18; no exploration because every city is a first or last somewhere.
    expect(plan.totalBillable).toBe(18);
    expect(plan.searches.some((s) => s.purpose === "exploration")).toBe(false);
    expect(plan.droppedForBudget).toEqual([]);
  });

  it("honours a configurable open-jaw cost", () => {
    const cheaper = ok(planSearches({ ...europeDryRun, openJawSearchCost: 1 }));
    expect(cheaper.totalBillable).toBe(12);
  });

  it("gives every search a reason and unique ascending priorities, long haul first", () => {
    expect(plan.searches.every((s) => s.reason.length > 0)).toBe(true);
    expect(plan.searches.map((s) => s.priority)).toEqual(plan.searches.map((_, i) => i + 1));
    expect(plan.searches.slice(0, 6).every((s) => s.purpose === "long_haul")).toBe(true);
    expect(new Set(plan.searches.map((s) => s.id)).size).toBe(plan.searches.length);
  });
});

describe("planSearches: budget", () => {
  it("drops the lowest-priority searches when over budget", () => {
    const plan = ok(planSearches({ ...europeDryRun, maxSearches: 7 }));
    // Open-jaws cost 2 each: three fit (6), the fourth would make 8 > 7, so it and everything after it drop.
    expect(plan.searches).toHaveLength(3);
    expect(plan.totalBillable).toBe(6);
    expect(plan.totalBillable).toBeLessThanOrEqual(7);
    expect(plan.droppedForBudget).toHaveLength(9);
    const worstKept = Math.max(...plan.searches.map((s) => s.priority));
    expect(plan.droppedForBudget.every((s) => s.priority > worstKept)).toBe(true);
    expect(plan.droppedForBudget.every((s) => s.reason.includes("over the search budget"))).toBe(true);
  });
});

describe("planSearches: asiaDryRun", () => {
  const plan = ok(planSearches(asiaDryRun));

  it("searches far fewer open-jaws than the 5*4=20 possible (first,last) pairs", () => {
    // 120 orders; 24 fail the Hong Kong event, 89 are >15% longer than the shortest; 7 are kept.
    // The 7 kept orders start or end in tokyo/chongqing/shenzhen/hongkong, giving 5 distinct
    // (first,last): tokyo>hongkong, shenzhen>tokyo, tokyo>shenzhen, chongqing>tokyo, tokyo>chongqing.
    expect(plan.keptOrders).toHaveLength(7);
    expect(plan.skippedOrders.map((s) => s.count)).toEqual([24, 89]);
    const longHaul = plan.searches.filter((s) => s.purpose === "long_haul");
    expect(longHaul).toHaveLength(5);
    expect(plan.searches.filter((s) => s.purpose === "exploration")).toHaveLength(1);
    expect(plan.searches.filter((s) => s.kind === "open_jaw")).toHaveLength(6);
  });

  it("adds one exploration search through the best hub not used as an end", () => {
    const ex = plan.searches.find((s) => s.purpose === "exploration")!;
    // beijing is never first or last in a kept order and PEK is tier 1.
    expect(ex.fromPlace).toBe("beijing");
    expect(ex.toPlace).toBe("tokyo");
    expect(ex.priority).toBe(plan.searches.length);
  });

  it("wide_open contraction makes every directed pair of the 5 cities searchable", () => {
    // 5 distinct open-jaws * 2 + 20 one-ways * 1 + 1 exploration * 2 = 32.
    expect(kind(plan.searches, "one_way")).toHaveLength(20);
    expect(plan.totalBillable).toBe(32);
  });

  it("without wide_open, intercity pairs come only from consecutive stops of kept orders", () => {
    const pinned = ok(planSearches({ ...asiaDryRun, mustInclude: asiaDryRun.cities.map((c) => c.id) }));
    expect(pinned.classification.modifiers).not.toContain("wide_open");
    const expected = new Set<string>();
    for (const k of pinned.keptOrders) for (let i = 0; i + 1 < k.order.length; i++) expected.add(`${k.order[i]}>${k.order[i + 1]}`);
    const got = new Set(kind(pinned.searches, "one_way").map((s) => `${s.fromPlace}>${s.toPlace}`));
    expect(got).toEqual(expected);
    expect(got.size).toBeLessThan(20);
  });

  it("long-haul dates are the trip dates", () => {
    for (const s of plan.searches.filter((x) => x.kind === "open_jaw")) {
      expect(s.legs[0]!.date).toBe("2027-06-01");
      expect(s.legs[1]!.date).toBe("2027-06-15");
    }
  });
});

describe("planSearches: shape of results", () => {
  it("a single city is a plain round trip", () => {
    const plan = ok(planSearches(synthInput([synthCity("solo", 35, 139)])));
    expect(plan.searches).toHaveLength(1);
    const s = plan.searches[0]!;
    expect(s.fromPlace).toBe("solo");
    expect(s.toPlace).toBe("solo");
    expect(s.legs[0]!.to).toEqual(s.legs[1]!.from);
    expect(plan.totalBillable).toBe(2);
  });

  it("is deterministic", () => {
    expect(planSearches(asiaDryRun)).toEqual(planSearches(asiaDryRun));
    expect(planSearches(europeDryRun)).toEqual(planSearches(europeDryRun));
  });
});

describe("planSearches: validation", () => {
  const errorsOf = (plan: SearchPlan) => (plan.ok ? [] : plan.errors);

  it("rejects an unknown city in lockedOrder", () => {
    const errors = errorsOf(planSearches({ ...europeDryRun, lockedOrder: ["rome", "atlantis"] }));
    expect(errors).toContainEqual(expect.objectContaining({ code: "unknown_city", path: "lockedOrder[1]" }));
  });

  it("rejects 9 cities", () => {
    const nine = Array.from({ length: 9 }, (_, i) => synthCity(`c${i}`, i, 100 + i));
    expect(errorsOf(planSearches(synthInput(nine))).map((e) => e.code)).toContain("too_many_cities");
  });

  it("rejects reversed dates", () => {
    const errors = errorsOf(planSearches({ ...europeDryRun, startDate: "2026-12-23", endDate: "2026-12-10" }));
    expect(errors.map((e) => e.code)).toContain("dates_reversed");
  });

  it("reports every problem at once", () => {
    const errors = errorsOf(
      planSearches({
        ...europeDryRun,
        startDate: "nope",
        cities: [...europeDryRun.cities, { ...europeDryRun.cities[0]! }, { ...europeDryRun.cities[1]!, id: "x", airports: [] }],
        home: { ...europeDryRun.home, airports: [] },
      }),
    );
    const codes = errors.map((e) => e.code);
    expect(codes).toEqual(expect.arrayContaining(["invalid_date", "duplicate_city", "no_airports"]));
  });

  it("rejects no cities", () => {
    expect(errorsOf(planSearches(synthInput([]))).map((e) => e.code)).toContain("no_cities");
  });

  it("fails clearly when constraints leave no feasible order", () => {
    const errors = errorsOf(planSearches({ ...europeDryRun, startCity: "rome", endCity: "rome" }));
    expect(errors.map((e) => e.code)).toContain("no_feasible_order");
  });
});
