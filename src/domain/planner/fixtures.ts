import type { PlannerCity, PlannerHome, PlannerInput } from "./types";

export const FAR_HOME: PlannerHome = { id: "home", lat: 45.42, lng: -75.7, airports: ["YOW", "YYZ", "YUL"] };

export function synthCity(id: string, lat: number, lng: number, extra: Partial<PlannerCity> = {}): PlannerCity {
  return { id, name: id, lat, lng, airports: [id.toUpperCase().slice(0, 3)], minNights: 2, ...extra };
}

export function synthInput(cities: PlannerCity[], extra: Partial<PlannerInput> = {}): PlannerInput {
  return { startDate: "2027-03-01", endDate: "2027-03-15", home: FAR_HOME, cities, ...extra };
}

/** Regular pentagon of radius 3 degrees on the equator-ish: a ring. */
export const ringCities = (): PlannerCity[] =>
  [0, 1, 2, 3, 4].map((k) =>
    synthCity(`r${k}`, 3 * Math.sin((2 * Math.PI * k) / 5), 100 + 3 * Math.cos((2 * Math.PI * k) / 5)),
  );

/** Four cities on the equator, 5 degrees apart. */
export const lineCities = (): PlannerCity[] => [0, 1, 2, 3].map((k) => synthCity(`l${k}`, 0, 100 + 5 * k));
