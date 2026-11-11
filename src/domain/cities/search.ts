// Pure city search over the bundled GeoNames list. Accent- and case-insensitive; a query
// matches the start of the name or the start of any word in it ("york" finds "New York").

export interface City {
  id: string;
  name: string;
  asciiName: string;
  country: string;
  lat: number;
  lng: number;
  population: number;
}

export const DEFAULT_CITY_LIMIT = 8;

export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function matches(candidate: string, query: string): boolean {
  const text = normalize(candidate);
  return text.startsWith(query) || text.includes(` ${query}`);
}

/** Cities are expected sorted by population, descending, so the first matches rank highest. */
export function searchCities(cities: readonly City[], query: string, limit: number = DEFAULT_CITY_LIMIT): City[] {
  const q = normalize(query);
  if (q === "" || limit <= 0) return [];
  const out: City[] = [];
  for (const city of cities) {
    if (matches(city.name, q) || matches(city.asciiName, q)) {
      out.push(city);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** "Paris, France" */
export function formatCity(city: Pick<City, "name" | "country">): string {
  return `${city.name}, ${city.country}`;
}

/** Why a city cannot be added to the candidate list, or null when it can. */
export function checkNewCity(existingNames: readonly string[], name: string, max: number): string | null {
  const wanted = normalize(name);
  if (existingNames.some((n) => normalize(n) === wanted)) return `${name} is already on the list.`;
  if (existingNames.length >= max) return `The list is full: routes can compare at most ${max} cities. Remove one first or plan fewer stops.`;
  return null;
}

/** Catalog coordinates for a "Name, Country" label, or null when no city matches exactly. */
export function coordinatesFor(cities: readonly City[], label: string): { lat: number; lng: number } | null {
  const wanted = normalize(label);
  const hit = cities.find((c) => normalize(formatCity(c)) === wanted);
  return hit ? { lat: hit.lat, lng: hit.lng } : null;
}
