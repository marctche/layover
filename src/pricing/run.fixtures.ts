// HAND-CONSTRUCTED TEST DATA, NOT CAPTURED RESPONSES. A fake provider that answers
// any search parameters with one valid option, so run tests need no network.
import type { SearchCache } from "./serpapi/cache";
import { cacheKey } from "./serpapi/cache";
import type { SearchParams } from "./serpapi/client";

interface FakeOptions {
  /** Whole dollars. Receives the parameters so a test can price searches differently. */
  price?: (params: SearchParams) => number;
  /** Extra, pricier options so a low price can be tested against its own response. */
  extraPrices?: (params: SearchParams) => number[];
  /** Index of the airport to use when a leg lists several. */
  airportIndex?: number;
}

const pick = (csv: string, index: number) => {
  const list = csv.split(",");
  return list[Math.min(index, list.length - 1)] as string;
};

function optionFor(from: string, to: string, date: string, price: number, token?: string) {
  return {
    flights: [
      {
        departure_airport: { id: from, name: from, time: `${date} 10:00` },
        arrival_airport: { id: to, name: to, time: `${date} 12:00` },
        duration: 120,
        airline: "Test Air",
      },
    ],
    total_duration: 120,
    price,
    ...(token ? { departure_token: token } : {}),
  };
}

export function fakeResponse(params: SearchParams, opts: FakeOptions = {}): unknown {
  const index = opts.airportIndex ?? 0;
  const price = (opts.price ?? (() => (params.type === "3" ? 1000 : 100)))(params);
  const prices = [price, ...(opts.extraPrices?.(params) ?? [])];
  const meta = { id: `fake-${cacheKey(params).slice(0, 12)}`, status: "Success" };
  const echo = { engine: "google_flights", ...params, travel_class: 1, adults: Number(params.adults) };

  if (params.type === "2") {
    const [from, to, date] = [pick(params.departure_id as string, index), pick(params.arrival_id as string, index), params.outbound_date as string];
    return { search_metadata: meta, search_parameters: echo, best_flights: prices.map((p) => optionFor(from, to, date, p)) };
  }
  const legs = JSON.parse(params.multi_city_json as string) as { departure_id: string; arrival_id: string; date: string }[];
  const leg = legs[params.departure_token ? 1 : 0] as (typeof legs)[number];
  const token = params.departure_token ? undefined : "fake-token";
  return {
    search_metadata: meta,
    search_parameters: echo,
    best_flights: prices.map((p) => optionFor(pick(leg.departure_id, index), pick(leg.arrival_id, index), leg.date, p, token)),
  };
}

/** Counts calls and answers each one with `fakeResponse` unless `override` returns text. */
export function fakeSearch(opts: FakeOptions & { override?: (params: SearchParams) => string | undefined } = {}) {
  const calls: SearchParams[] = [];
  const search = async (params: SearchParams) => {
    calls.push(params);
    return { text: opts.override?.(params) ?? JSON.stringify(fakeResponse(params, opts)), fetchedAt: "2026-11-07T12:00:00.000Z" };
  };
  return { calls, search };
}

export function memoryCache(): SearchCache & { size(): number } {
  const store = new Map<string, { text: string; fetchedAt: string }>();
  return {
    get: (p) => store.get(cacheKey(p)) ?? null,
    put: (p, e) => void store.set(cacheKey(p), e),
    size: () => store.size,
  };
}
