import { describe, expect, it } from "vitest";
import { asiaDryRun, europeDryRun } from "./catalog";
import { classify } from "./classify";
import { lineCities, ringCities, synthCity, synthInput } from "./fixtures";

describe("classify", () => {
  it("europeDryRun is a long-haul cluster", () => {
    const c = classify(europeDryRun);
    expect(c.shape).toBe("cluster");
    expect(c.longHaul).toBe(true);
    expect(c.features.linearity).toBeGreaterThan(1.4);
    expect(c.features.linearity).toBeLessThan(1.7);
    expect(Math.abs(c.features.shortestOpenPathKm - 1690)).toBeLessThanOrEqual(15);
    expect(c.modifiers).not.toContain("large");
    expect(c.reasons.some((r) => r.includes("linearity 1.53") && r.includes("1,690 km") && r.includes("1,106 km"))).toBe(true);
  });

  it("asiaDryRun: computed linearity 1.47 makes it a cluster, not a corridor", () => {
    // The spec expected a corridor. The geometry says otherwise (4,660 km shortest
    // path over a 3,162 km widest pair), and thresholds are deliberately not bent.
    const c = classify(asiaDryRun);
    expect(c.shape).toBe("cluster");
    expect(c.features.linearity).toBeCloseTo(1.47, 2);
    expect(c.features.closedTourKm).toBeGreaterThan(1.3 * c.features.shortestOpenPathKm);
    expect(c.modifiers).toContain("anchored");
    expect(c.modifiers).toContain("wide_open");
  });

  it("flags the borderline band", () => {
    // Triangle: two cities 10 degrees apart on the equator and a third 4 degrees off the midpoint.
    const tri = [synthCity("a", 0, 100), synthCity("b", 0, 110), synthCity("c", 4, 105)];
    const c = classify(synthInput(tri));
    expect(c.features.linearity).toBeGreaterThan(1.25);
    expect(c.features.linearity).toBeLessThanOrEqual(1.4);
    expect(c.shape).toBe("cluster");
    expect(c.reasons).toContain("between corridor and cluster; chose cluster because it searches more");
    expect(classify(asiaDryRun).reasons).not.toContain("between corridor and cluster; chose cluster because it searches more");
  });

  it("a ring of 5 cities is a loop and the reason mentions the ground leg", () => {
    const c = classify(synthInput(ringCities()));
    expect(c.shape).toBe("loop");
    expect(c.features.closedTourKm / c.features.shortestOpenPathKm).toBeCloseTo(1.25, 2);
    expect(c.reasons.some((r) => r.includes("ground leg the engine does not model yet"))).toBe(true);
  });

  it("a straight line of 4 cities is a corridor with linearity 1", () => {
    const c = classify(synthInput(lineCities()));
    expect(c.shape).toBe("corridor");
    expect(c.features.linearity).toBeCloseTo(1, 6);
  });

  it("one city: zero path, linearity 1, not a loop", () => {
    const c = classify(synthInput([lineCities()[0]!]));
    expect(c.features.shortestOpenPathKm).toBe(0);
    expect(c.features.linearity).toBe(1);
    expect(c.shape).toBe("corridor");
  });

  it("modifiers: mostly_locked, large, and required cities", () => {
    const six = [0, 1, 2, 3, 4, 5].map((k) => lineCities()[0] && { ...lineCities()[0]!, id: `x${k}`, lng: 100 + k });
    const big = classify(synthInput(six as never));
    expect(big.modifiers).toContain("large");
    const locked = classify(synthInput(lineCities(), { lockedOrder: ["l0", "l1", "l2", "l3"] }));
    expect(locked.modifiers).toContain("mostly_locked");
    expect(locked.modifiers).not.toContain("wide_open");
    const ends = classify(synthInput(lineCities().slice(0, 3), { startCity: "l0", endCity: "l2" }));
    expect(ends.modifiers).toContain("mostly_locked");
    expect(ends.modifiers).toContain("wide_open");
  });

  it("not long haul when the nearest city is within 3,000 km", () => {
    const c = classify({ ...synthInput(lineCities()), home: { id: "h", lat: 0, lng: 98, airports: ["AAA"] } });
    expect(c.longHaul).toBe(false);
  });
});
