// Layer 1: check every provider response against the request that produced it.
// Pure: raw JSON in, verified options or a typed miss out. A failed response is
// missing data, never a zero or a guess.
import { minorUnitDigits, money } from "@/domain/money/money";
import type { PlannedSearch } from "@/domain/planner/types";
import { echoedLegsSchema, envelopeSchema, optionSchema } from "./schema";
import type { Envelope, RawOption } from "./schema";
import type {
  MissingReason,
  PriceFlag,
  RejectedOption,
  RequestedLeg,
  SearchRequest,
  VerifiedOption,
  VerifiedSearch,
} from "./types";

/** Segment plus layover minutes may differ from total_duration by this much. */
export const DURATION_TOLERANCE_MINUTES = 2;

const PROVIDER_TYPE = { one_way: "2", multi_city: "3" } as const;
const NO_RESULTS = /no results|hasn't returned any results/i;
const MAX_DETAIL_LENGTH = 200;

const clip = (text: string) => text.slice(0, MAX_DETAIL_LENGTH);
const miss = (reason: MissingReason, detail: string, rejected: RejectedOption[] = []): VerifiedSearch => ({
  ok: false,
  reason,
  detail: clip(detail),
  rejected,
});

/** Builds the check for one planner search. legIndex 1 is the departure_token call. */
export function requestFromPlan(search: PlannedSearch, legIndex: number, currency: string, adults: number): SearchRequest {
  return {
    kind: search.kind === "open_jaw" ? "multi_city" : "one_way",
    legs: search.legs,
    legIndex,
    currency,
    adults,
  };
}

const sameSet = (csv: string, wanted: readonly string[]) => {
  const got = new Set(csv.split(",").map((s) => s.trim()));
  return got.size === new Set(wanted).size && wanted.every((a) => got.has(a));
};

function echoedMultiCity(json: string): { departure_id: string; arrival_id: string; date: string }[] | null {
  try {
    const parsed = echoedLegsSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** First difference between what we asked for and what the provider says it searched. */
function echoMismatch(p: Envelope["search_parameters"], req: SearchRequest): string | null {
  if (p.currency !== req.currency) return `currency ${p.currency}, asked ${req.currency}`;
  if (Number(p.adults) !== req.adults) return `adults ${p.adults}, asked ${req.adults}`;
  if (String(p.type) !== PROVIDER_TYPE[req.kind]) return `type ${p.type}, asked ${PROVIDER_TYPE[req.kind]}`;

  if (req.kind === "one_way") {
    const leg = req.legs[0] as RequestedLeg;
    if (p.departure_id === undefined || !sameSet(p.departure_id, leg.from)) return `departure_id ${p.departure_id}`;
    if (p.arrival_id === undefined || !sameSet(p.arrival_id, leg.to)) return `arrival_id ${p.arrival_id}`;
    if (p.outbound_date !== leg.date) return `outbound_date ${p.outbound_date}, asked ${leg.date}`;
    return null;
  }

  const echoed = p.multi_city_json === undefined ? null : echoedMultiCity(p.multi_city_json);
  if (echoed === null) return "multi_city_json missing or unreadable";
  if (echoed.length !== req.legs.length) return `${echoed.length} legs echoed, asked ${req.legs.length}`;
  for (const [i, leg] of req.legs.entries()) {
    const e = echoed[i] as (typeof echoed)[number];
    if (!sameSet(e.departure_id, leg.from) || !sameSet(e.arrival_id, leg.to) || e.date !== leg.date) {
      return `multi_city_json leg ${i} differs`;
    }
  }
  return null;
}

function checkOption(option: RawOption, leg: RequestedLeg, currency: string): VerifiedOption | RejectedOption {
  const { flights, price } = option;
  const first = flights[0] as RawOption["flights"][number];
  const last = flights[flights.length - 1] as RawOption["flights"][number];
  const origin = first.departure_airport.id;
  const destination = last.arrival_airport.id;

  if (price === undefined || !Number.isSafeInteger(price) || price <= 0) {
    return { reason: "bad_price", detail: `price ${String(price)}` };
  }
  if (!leg.from.includes(origin)) return { reason: "wrong_origin", detail: `departs ${origin}` };
  if (!leg.to.includes(destination)) return { reason: "wrong_destination", detail: `arrives ${destination}` };
  const departureDate = first.departure_airport.time.slice(0, 10);
  if (departureDate !== leg.date) return { reason: "wrong_date", detail: `departs ${departureDate}, asked ${leg.date}` };

  const layovers = option.layovers ?? [];
  const summed = [...flights, ...layovers].reduce((n, part) => n + part.duration, 0);
  if (Math.abs(summed - option.total_duration) > DURATION_TOLERANCE_MINUTES) {
    return { reason: "duration_mismatch", detail: `parts sum to ${summed}, total_duration ${option.total_duration}` };
  }

  // A connection can legitimately change airports inside one city (JFK to LGA), so
  // this warns instead of rejecting: the fare is real but the transfer is on the traveler.
  const flags: PriceFlag[] = [];
  for (let i = 0; i + 1 < flights.length; i++) {
    const arrives = (flights[i] as RawOption["flights"][number]).arrival_airport.id;
    const departs = (flights[i + 1] as RawOption["flights"][number]).departure_airport.id;
    if (arrives !== departs) {
      flags.push({ code: "airport_change_connection", severity: "warn", detail: `arrives ${arrives}, next flight leaves ${departs}` });
    }
  }

  const verified: VerifiedOption = {
    price: money(price * 10 ** minorUnitDigits(currency), currency),
    totalMinutes: option.total_duration,
    stops: flights.length - 1,
    originAirport: origin,
    destinationAirport: destination,
    airlines: [...new Set(flights.flatMap((f) => (f.airline ? [f.airline] : [])))],
    flags,
  };
  if (option.departure_token) verified.departureToken = option.departure_token;
  if (option.booking_token) verified.bookingToken = option.booking_token;
  return verified;
}

/** Cheapest first; shorter breaks ties, then fewer flags, then provider order. */
function rank(a: VerifiedOption, b: VerifiedOption): number {
  return a.price.amountMinor - b.price.amountMinor || a.totalMinutes - b.totalMinutes || a.flags.length - b.flags.length;
}

export function verifySearchResponse(raw: unknown, request: SearchRequest, fetchedAt: string): VerifiedSearch {
  const errorText = (raw as { error?: unknown } | null)?.error;
  if (typeof errorText === "string") {
    return miss(NO_RESULTS.test(errorText) ? "no_results" : "provider_error", errorText);
  }

  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) return miss("malformed_response", envelope.error.issues[0]?.message ?? "unreadable response");
  const body = envelope.data;

  if (body.search_metadata.status !== "Success") return miss("provider_error", `status ${body.search_metadata.status}`);

  const mismatch = echoMismatch(body.search_parameters, request);
  if (mismatch) return miss("request_mismatch", mismatch);

  const rawOptions = [...(body.best_flights ?? []), ...(body.other_flights ?? [])];
  if (rawOptions.length === 0) return miss("no_results", "no options returned");

  const leg = request.legs[request.legIndex];
  if (!leg) return miss("request_mismatch", `no requested leg ${request.legIndex}`);

  const options: VerifiedOption[] = [];
  const rejected: RejectedOption[] = [];
  for (const rawOption of rawOptions) {
    const parsed = optionSchema.safeParse(rawOption);
    if (!parsed.success) {
      rejected.push({ reason: "malformed_option", detail: clip(parsed.error.issues[0]?.message ?? "unreadable option") });
      continue;
    }
    const checked = checkOption(parsed.data, leg, request.currency);
    if ("reason" in checked) rejected.push(checked);
    else options.push(checked);
  }

  if (options.length === 0) return miss("no_valid_options", `all ${rawOptions.length} options failed`, rejected);
  return {
    ok: true,
    options: options.sort(rank),
    rejected,
    provenance: { provider: "serpapi", searchId: body.search_metadata.id, fetchedAt, adults: request.adults },
  };
}
