import type { Money } from "@/domain/money/money";
import type { Leg, LongHaulFare } from "@/domain/trip/types";

export interface RequestedLeg {
  from: readonly string[];
  to: readonly string[];
  /** YYYY-MM-DD */
  date: string;
}

/** What we asked the provider for. Responses are checked against this, never trusted. */
export interface SearchRequest {
  kind: "one_way" | "multi_city";
  legs: readonly RequestedLeg[];
  /** The leg this response covers: 0 for the first call, 1 for the departure_token call. */
  legIndex: number;
  currency: string;
  adults: number;
}

export type MissingReason =
  | "provider_error"
  | "no_results"
  | "malformed_response"
  | "request_mismatch"
  | "no_valid_options"
  | "adults_not_one";

export type OptionRejection =
  | "malformed_option"
  | "bad_price"
  | "wrong_origin"
  | "wrong_destination"
  | "wrong_date"
  | "duration_mismatch";

export interface RejectedOption {
  reason: OptionRejection;
  detail: string;
}

export type FlagSeverity =
  /** Used, with the warning attached. */
  | "warn"
  /** Kept out of engine input until a person confirms it. */
  | "hold";

export type PriceFlagCode =
  | "airport_change_connection"
  | "far_below_response_options"
  | "far_below_similar_routes"
  | "far_above_similar_routes"
  | "fare_changed_between_calls"
  | "fare_above_one_way_pair";

export interface PriceFlag {
  code: PriceFlagCode;
  severity: FlagSeverity;
  detail: string;
}

export interface VerifiedOption {
  price: Money;
  totalMinutes: number;
  stops: number;
  /** The airports actually used. A list of home airports may resolve to any of them. */
  originAirport: string;
  destinationAirport: string;
  airlines: string[];
  departureToken?: string;
  bookingToken?: string;
  flags: PriceFlag[];
}

export interface Provenance {
  provider: "serpapi";
  searchId: string;
  fetchedAt: string;
  adults: number;
}

export type VerifiedSearch =
  | { ok: true; options: VerifiedOption[]; rejected: RejectedOption[]; provenance: Provenance }
  | { ok: false; reason: MissingReason; detail: string; rejected: RejectedOption[] };

/** No placeholder price exists on the failure branch: the route simply stays unpriced. */
export type Missing = { ok: false; reason: MissingReason; detail: string };

export interface PricedBase {
  /** Identifies the search, e.g. the planner's search id. */
  id: string;
  price: Money;
  /** Great-circle km flown, for comparing unlike routes. */
  km: number;
  provenance: Provenance;
  flags: PriceFlag[];
}

export interface PricedLeg extends PricedBase {
  kind: "one_way";
  leg: Leg;
  originAirport: string;
  destinationAirport: string;
}

export interface PricedFare extends PricedBase {
  kind: "open_jaw";
  fare: LongHaulFare;
  outboundOriginAirport: string;
  returnDestinationAirport: string;
  /** Total of the matching one-way pair, when those were searched. */
  oneWayPairPrice?: Money;
}

export type Priced = PricedLeg | PricedFare;
