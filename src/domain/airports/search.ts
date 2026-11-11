// Pure airport search over the bundled OurAirports list. Accent- and case-insensitive. An exact
// three-letter code ranks first; then city prefix, airport-name prefix, then later words. Within
// each group: major hubs first, then large before medium, then catalog order.
import { normalize } from "../cities/search";
import { SEARCH_CITY_ALIASES, searchHubRank } from "./hubs";

export interface Airport {
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  size: "large" | "medium";
}

export const DEFAULT_AIRPORT_LIMIT = 8;

/** 0 = city starts with the query, 1 = name starts with it, 2 = a later word in either, null = no match. */
function tier(a: Airport, q: string): number | null {
  const city = normalize(a.city);
  const name = normalize(a.name);
  const alias = SEARCH_CITY_ALIASES[a.iata];
  if (city.startsWith(q) || (alias !== undefined && normalize(alias).startsWith(q))) return 0;
  if (name.startsWith(q)) return 1;
  if (city.includes(` ${q}`) || name.includes(` ${q}`)) return 2;
  return null;
}

export function searchAirports(
  airports: readonly Airport[],
  query: string,
  limit: number = DEFAULT_AIRPORT_LIMIT,
): Airport[] {
  const q = normalize(query);
  if (q === "" || limit <= 0) return [];
  const exact = q.length === 3 ? airports.find((a) => a.iata.toLowerCase() === q) : undefined;
  const ranked: { airport: Airport; tier: number; hub: number; large: number; index: number }[] = [];
  airports.forEach((airport, index) => {
    if (airport === exact) return;
    const t = tier(airport, q);
    if (t !== null) ranked.push({ airport, tier: t, hub: searchHubRank(airport.iata), large: airport.size === "large" ? 0 : 1, index });
  });
  ranked.sort((x, y) => x.tier - y.tier || x.hub - y.hub || x.large - y.large || x.index - y.index);
  const out = ranked.map((r) => r.airport);
  return (exact ? [exact, ...out] : out).slice(0, limit);
}

/** The airport with this IATA code (case-insensitive), or undefined. */
export function findAirport(airports: readonly Airport[], code: string): Airport | undefined {
  const wanted = code.trim().toUpperCase();
  return airports.find((a) => a.iata === wanted);
}

/** "Toronto Pearson (YYZ), Canada" */
export function formatAirport(a: Pick<Airport, "iata" | "name" | "country">): string {
  const short = a.name.replace(/ (International )?Airport$/, "").replace(/ International$/, "");
  return `${short || a.name} (${a.iata}), ${a.country}`;
}
