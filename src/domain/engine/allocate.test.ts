import { describe, expect, it } from "vitest";
import { allocateNights, type AllocationCity } from "./allocate";

const city = (id: string, minNights: number, weight = 0, maxNights?: number): AllocationCity => {
  const c: AllocationCity = { id, minNights, weight };
  if (maxNights !== undefined) c.maxNights = maxNights;
  return c;
};

describe("allocateNights", () => {
  it("sums to the total and respects min and max", () => {
    const order = [city("a", 2, 1, 5), city("b", 1, 3, 4), city("c", 2, 0, 3)];
    const r = allocateNights(order, 10, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nights.reduce((a, b) => a + b, 0)).toBe(10);
    r.nights.forEach((n, i) => {
      expect(n).toBeGreaterThanOrEqual(order[i]!.minNights);
      expect(n).toBeLessThanOrEqual(order[i]!.maxNights ?? 10);
    });
  });

  it("gives spare nights to the highest-weight city first, ties by position", () => {
    const r = allocateNights([city("a", 1, 5), city("b", 1, 9), city("c", 1, 9)], 6, []);
    expect(r).toEqual({ ok: true, nights: [1, 4, 1] });
  });

  it("covers a fixed event", () => {
    // Night 3 must be spent in c.
    const r = allocateNights([city("a", 1), city("b", 1), city("c", 1)], 5, [{ cityId: "c", firstNight: 3, lastNight: 3 }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const start = r.nights[0]! + r.nights[1]!;
    expect(start).toBeLessThanOrEqual(3);
    expect(start + r.nights[2]! - 1).toBeGreaterThanOrEqual(3);
  });

  it("finds an allocation even though minimums in order would miss the event", () => {
    const order = [city("a", 1), city("b", 1, 10), city("c", 1)];
    const event = [{ cityId: "c", firstNight: 3, lastNight: 3 }];
    // Minimums put c on night 2 only. b has the top weight and takes a spare night, but
    // only one: a second would push c past night 3.
    const r = allocateNights(order, 5, event);
    expect(r).toEqual({ ok: true, nights: [1, 2, 2] });
  });

  it("spans multi-night events", () => {
    const r = allocateNights([city("a", 1), city("b", 2)], 6, [{ cityId: "b", firstNight: 2, lastNight: 4 }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nights[0]).toBeLessThanOrEqual(2);
    expect(r.nights[0]! + r.nights[1]!).toBe(6);
  });

  it("reports infeasible when minimums exceed the total", () => {
    expect(allocateNights([city("a", 3), city("b", 3)], 5, [])).toEqual({ ok: false });
  });

  it("reports infeasible when maximums cannot fill the total", () => {
    expect(allocateNights([city("a", 1, 0, 2), city("b", 1, 0, 2)], 5, [])).toEqual({ ok: false });
  });

  it("reports infeasible when an event is longer than the city's maximum", () => {
    const r = allocateNights([city("a", 1, 0, 2), city("b", 1)], 5, [{ cityId: "a", firstNight: 0, lastNight: 2 }]);
    expect(r).toEqual({ ok: false });
  });

  it("reports infeasible when two events collide in different cities", () => {
    const r = allocateNights([city("a", 1), city("b", 1)], 4, [
      { cityId: "a", firstNight: 2, lastNight: 2 },
      { cityId: "b", firstNight: 2, lastNight: 2 },
    ]);
    expect(r).toEqual({ ok: false });
  });
});
