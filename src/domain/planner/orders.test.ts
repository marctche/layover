import { describe, expect, it } from "vitest";
import { europeDryRun } from "./catalog";
import { classify } from "./classify";
import { synthCity, synthInput } from "./fixtures";
import { candidateOrders } from "./orders";
import type { PlannerInput } from "./types";

const run = (input: PlannerInput) => candidateOrders(input, classify(input));

describe("candidateOrders", () => {
  it("europeDryRun keeps all 6 orders (3 or fewer cities)", () => {
    const { kept, skipped } = run(europeDryRun);
    expect(kept).toHaveLength(6);
    expect(skipped).toEqual([]);
    const first = kept[0]!;
    expect(["paris>barcelona>rome", "rome>barcelona>paris"]).toContain(first.order.join(">"));
    expect(Math.abs(first.km - 1690)).toBeLessThanOrEqual(15);
    expect(kept[1]!.km).toBeCloseTo(first.km, 6);
    const stated = kept.find((k) => k.order.join(">") === "barcelona>rome>paris");
    expect(stated?.why).toBe("the order you typed, kept for comparison");
    expect(kept.some((k) => k.why === "3 or fewer cities: every order is cheap to price")).toBe(true);
    expect(kept.every((k) => k.why.length > 0)).toBe(true);
  });

  it("counts orders that break lockedOrder", () => {
    const { kept, skipped } = run({ ...europeDryRun, lockedOrder: ["rome", "barcelona"] });
    expect(kept).toHaveLength(3);
    expect(kept.every((k) => k.order.indexOf("rome") < k.order.indexOf("barcelona"))).toBe(true);
    expect(skipped).toEqual([{ count: 3, why: "breaks the locked order (rome > barcelona)" }]);
  });

  it("applies startCity and endCity", () => {
    const { kept, skipped } = run({ ...europeDryRun, startCity: "rome", endCity: "paris" });
    expect(kept.map((k) => k.order.join(">"))).toEqual(["rome>barcelona>paris"]);
    expect(skipped.reduce((s, x) => s + x.count, 0)).toBe(5);
  });

  const abc = [synthCity("a", 0, 100, { minNights: 3 }), synthCity("b", 0, 101, { minNights: 3 }), synthCity("c", 0, 102, { minNights: 3 })];

  it("skips orders that put the event city too late (event on night 0)", () => {
    // Event in a on the first night: a must be first, so the 4 orders with a later are out.
    const input = synthInput(abc, { fixedEvents: [{ cityId: "a", startDate: "2027-03-01", endDate: "2027-03-01" }] });
    const { kept, skipped } = run(input);
    expect(kept.map((k) => k.order[0])).toEqual(["a", "a"]);
    expect(skipped).toEqual([{ count: 4, why: "cannot meet the fixed event in a (2027-03-01 to 2027-03-01) with this order" }]);
  });

  it("skips orders that put the event city too early (event on night 13, max 7 nights each)", () => {
    // Before the event we can spend at most 7 nights per city, so a needs two cities before it (14 >= 13).
    const capped = abc.map((c) => ({ ...c, maxNights: 7 }));
    const input = synthInput(capped, { fixedEvents: [{ cityId: "a", startDate: "2027-03-14", endDate: "2027-03-14" }] });
    const { kept, skipped } = run(input);
    expect(kept.every((k) => k.order[2] === "a")).toBe(true);
    expect(kept).toHaveLength(2);
    expect(skipped[0]?.count).toBe(4);
  });

  it("skips orders when the minimum nights before the event overshoot it", () => {
    // Event on night 4 in c: two cities before need at least 6 nights, one city needs 3.
    const input = synthInput(abc, { fixedEvents: [{ cityId: "c", startDate: "2027-03-05", endDate: "2027-03-05" }] });
    const { kept } = run(input);
    expect(kept.every((k) => k.order.indexOf("c") === 1)).toBe(true);
    expect(kept).toHaveLength(2);
  });

  it("rejects an event stay longer than the city's maxNights", () => {
    const capped = abc.map((c) => ({ ...c, maxNights: 2 }));
    const input = synthInput(capped, { fixedEvents: [{ cityId: "a", startDate: "2027-03-01", endDate: "2027-03-04" }] });
    expect(run(input).kept).toHaveLength(0);
  });

  it("filters by geography for 4+ cities and always keeps the stated order", () => {
    const line = [0, 1, 2, 3].map((k) => synthCity(`l${k}`, 0, 100 + 5 * k));
    const stated = ["l1", "l3", "l0", "l2"];
    const { kept, skipped } = run(synthInput(line, { statedOrder: stated }));
    const keys = kept.map((k) => k.order.join(">"));
    expect(keys).toContain("l0>l1>l2>l3");
    expect(keys).toContain("l3>l2>l1>l0");
    expect(keys).toContain(stated.join(">"));
    expect(kept.find((k) => k.order.join(">") === stated.join(">"))?.why).toBe("the order you typed, kept for comparison");
    const skippedTotal = skipped.reduce((s, x) => s + x.count, 0);
    expect(kept.length + skippedTotal).toBe(24);
    expect(kept.length).toBeLessThan(24);
    // sorted by km then order string
    for (let i = 1; i < kept.length; i++) expect(kept[i]!.km).toBeGreaterThanOrEqual(kept[i - 1]!.km);
  });

  it("large trips cap kept orders at 12 (plus the stated order)", () => {
    // Two tight clusters of 3 cities, 20 degrees apart: the 72 orders that finish one cluster
    // before starting the other are all within 10% of each other, so only the cap trims them.
    const a = [0, 1, 2].map((k) => synthCity(`a${k}`, 0, 100 + k * 0.01));
    const b = [0, 1, 2].map((k) => synthCity(`b${k}`, 0, 120 + k * 0.01));
    const stated = ["a0", "b0", "a1", "b1", "a2", "b2"];
    const input = synthInput([...a, ...b], { statedOrder: stated });
    const { kept, skipped } = run(input);
    expect(kept).toHaveLength(13);
    expect(kept.some((k) => k.order.join(",") === stated.join(","))).toBe(true);
    expect(skipped.find((s) => s.why.includes("cap of 12"))?.count).toBe(60);
    expect(skipped.reduce((s, x) => s + x.count, 0) + kept.length).toBe(720);
  });
});
