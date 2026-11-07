// Curated coordinates for demo/dry-run trips. Not a world catalog.
// No prices, durations, or ground-leg costs live here.
import type { PlannerCity, PlannerHome, PlannerInput } from "./types";

export const HOMES: Record<string, PlannerHome> = {
  ottawa: { id: "ottawa", lat: 45.42, lng: -75.7, airports: ["YOW", "YYZ", "YUL"] },
};

const city = (id: string, name: string, lat: number, lng: number, airports: string[]) => ({
  id,
  name,
  lat,
  lng,
  airports,
});

export const CITY_CATALOG: Record<string, Omit<PlannerCity, "minNights" | "maxNights">> = {
  barcelona: city("barcelona", "Barcelona", 41.39, 2.17, ["BCN"]),
  rome: city("rome", "Rome", 41.9, 12.5, ["FCO", "CIA"]),
  paris: city("paris", "Paris", 48.86, 2.35, ["CDG", "ORY"]),
  tokyo: city("tokyo", "Tokyo", 35.68, 139.69, ["HND", "NRT"]),
  seoul: city("seoul", "Seoul", 37.57, 126.98, ["ICN", "GMP"]),
  beijing: city("beijing", "Beijing", 39.9, 116.41, ["PEK", "PKX"]),
  chongqing: city("chongqing", "Chongqing", 29.56, 106.55, ["CKG"]),
  shenzhen: city("shenzhen", "Shenzhen", 22.54, 114.06, ["SZX"]),
  hongkong: city("hongkong", "Hong Kong", 22.32, 114.17, ["HKG"]),
};

function pick(id: string, minNights: number, maxNights?: number): PlannerCity {
  const base = CITY_CATALOG[id];
  if (!base) throw new Error(`Unknown catalog city: ${id}`);
  return maxNights === undefined ? { ...base, minNights } : { ...base, minNights, maxNights };
}

export const europeDryRun: PlannerInput = {
  startDate: "2026-12-10",
  endDate: "2026-12-23",
  home: HOMES.ottawa as PlannerHome,
  cities: [pick("barcelona", 2, 7), pick("rome", 2, 7), pick("paris", 2, 7)],
  statedOrder: ["barcelona", "rome", "paris"],
};

export const asiaDryRun: PlannerInput = {
  startDate: "2027-06-01",
  endDate: "2027-06-15",
  home: HOMES.ottawa as PlannerHome,
  cities: [pick("tokyo", 2), pick("beijing", 2), pick("chongqing", 2), pick("shenzhen", 1), pick("hongkong", 2)],
  fixedEvents: [{ cityId: "hongkong", startDate: "2027-06-12", endDate: "2027-06-12" }],
  statedOrder: ["tokyo", "beijing", "chongqing", "shenzhen", "hongkong"],
};
