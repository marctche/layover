import { describe, expect, it } from "vitest";
import { CITY_CATALOG } from "./catalog";
import { haversineKm, pathKm } from "./geo";
import type { PlannerCity } from "./types";

const c = (id: string) => CITY_CATALOG[id] as Omit<PlannerCity, "minNights">;

describe("haversineKm", () => {
  it("Paris-Barcelona is about 830 km", () => {
    expect(haversineKm(c("paris"), c("barcelona"))).toBeCloseTo(830, -1);
    expect(Math.abs(haversineKm(c("paris"), c("barcelona")) - 830)).toBeLessThanOrEqual(15);
  });
  it("Barcelona-Rome is about 860 km", () => {
    expect(Math.abs(haversineKm(c("barcelona"), c("rome")) - 860)).toBeLessThanOrEqual(15);
  });
  it("Rome-Paris is about 1,105 km", () => {
    expect(Math.abs(haversineKm(c("rome"), c("paris")) - 1105)).toBeLessThanOrEqual(15);
  });
  it("is symmetric and zero for the same point", () => {
    expect(haversineKm(c("rome"), c("paris"))).toBeCloseTo(haversineKm(c("paris"), c("rome")), 9);
    expect(haversineKm(c("rome"), c("rome"))).toBe(0);
  });
});

describe("pathKm", () => {
  it("sums legs in order", () => {
    const byId = new Map(["paris", "barcelona", "rome"].map((id) => [id, { ...c(id), minNights: 1 }]));
    const total = pathKm(["paris", "barcelona", "rome"], byId);
    expect(total).toBeCloseTo(haversineKm(c("paris"), c("barcelona")) + haversineKm(c("barcelona"), c("rome")), 6);
    expect(Math.abs(total - 1690)).toBeLessThanOrEqual(15);
    expect(pathKm(["rome"], byId)).toBe(0);
  });
});
