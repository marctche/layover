// One SerpApi Google Flights search with an injected fetch. The API key lives in
// the URL, so errors here never carry the URL and the response text is scrubbed.
import type { PlannedLeg } from "@/domain/planner/types";

export const SEARCH_URL = "https://serpapi.com/search.json";
export const CURRENCY = "CAD";
export const ADULTS = 1;

export type SearchParams = Record<string, string>;

export interface SearchCall {
  kind: "one_way" | "multi_city";
  legs: readonly PlannedLeg[];
  /** From the chosen outbound option; makes this the return-leg call of a multi-city search. */
  departureToken?: string;
}

/** Parameters without the key: safe to hash, cache and log. */
export function buildSearchParams(call: SearchCall): SearchParams {
  const base: SearchParams = {
    engine: "google_flights",
    currency: CURRENCY,
    gl: "ca",
    hl: "en",
    adults: String(ADULTS),
    travel_class: "1",
  };
  if (call.kind === "one_way") {
    const leg = call.legs[0];
    if (!leg) throw new Error("A one-way search needs one leg");
    return { ...base, type: "2", departure_id: leg.from.join(","), arrival_id: leg.to.join(","), outbound_date: leg.date };
  }
  const multiCity = JSON.stringify(call.legs.map((l) => ({ departure_id: l.from.join(","), arrival_id: l.to.join(","), date: l.date })));
  const params: SearchParams = { ...base, type: "3", multi_city_json: multiCity };
  if (call.departureToken) params.departure_token = call.departureToken;
  return params;
}

export class SerpApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SerpApiError";
  }
}

export const scrubKey = (text: string, apiKey: string): string =>
  apiKey ? text.split(apiKey).join("[redacted]").split(encodeURIComponent(apiKey)).join("[redacted]") : text;

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Returns the response text with the key removed. Throws a SerpApiError that names neither URL nor key. */
export async function searchOnce(params: SearchParams, deps: { apiKey: string; fetch: FetchLike }): Promise<string> {
  if (!deps.apiKey) throw new SerpApiError("SERPAPI_API_KEY is not set");
  const url = `${SEARCH_URL}?${new URLSearchParams({ ...params, api_key: deps.apiKey }).toString()}`;

  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await deps.fetch(url);
  } catch {
    throw new SerpApiError("network error reaching the provider");
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new SerpApiError(`HTTP ${response.status}: unreadable body`);
  }
  // A provider error body is JSON with an `error` field; verification turns it into a miss.
  if (!response.ok && !text.trimStart().startsWith("{")) throw new SerpApiError(`HTTP ${response.status}`);
  return scrubKey(text, deps.apiKey);
}
