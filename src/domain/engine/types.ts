import type { Money } from "../money/money";
import type { Leg, PriceSource } from "../trip/types";

export type EngineErrorCode =
  | "invalid_date"
  | "dates_reversed"
  | "too_many_cities"
  | "currency_mismatch"
  | "unknown_city"
  | "unknown_traveler"
  | "duplicate_id"
  | "invalid_city"
  | "no_travelers"
  | "missing_city_costs"
  | "event_out_of_range"
  | "invalid_option"
  | "city_required"
  | "no_feasible_route"
  | "traveler_mismatch"
  | "trip_too_long"
  | "invalid_leg"
  | "invalid_cost"
  | "invalid_preference"
  | "invalid_budget"
  | "events_conflict"
  | "home_is_city";

export interface EngineError {
  code: EngineErrorCode;
  message: string;
  path?: string;
  /** Present only on no_feasible_route. */
  rejections?: RejectionSummary;
  /** Present only on no_feasible_route: what dropping each droppable required city would give. */
  dropOptions?: DropOption[];
}

export interface DropOption {
  cityId: string;
  /** Feasible routes once this city is removed from the set. */
  feasibleCount: number;
  /** Cheapest feasible route without the city; null if still infeasible. */
  cheapest: RoutePlan | null;
}

export type RejectionReason =
  | "missing_leg"
  | "missing_home_leg"
  | "min_nights_exceeded"
  | "no_valid_allocation"
  | "over_budget"
  | "order_locked";

/**
 * Counts of pruned branches by reason. A pruned prefix counts once, so these
 * are not permutation counts. Counts only: no amounts, no traveler ids.
 */
export type RejectionSummary = Record<RejectionReason, number>;

export interface Stop {
  cityId: string;
  nights: number;
  firstNight: number;
  /** Date of the first night. */
  checkIn: string;
  /** Date after the last night. */
  checkOut: string;
}

export interface TravelerCost {
  travelerId: string;
  international: Money;
  intercity: Money;
  lodging: Money;
  daily: Money;
  total: Money;
  /** Which ticket form produced `international`. */
  internationalTicket: "one_way_pair" | "fare";
  /** Ceiling minus total. Only this traveler's own entry carries it. */
  headroom?: Money;
  priceSources: PriceSource[];
}

export interface RouteMetrics {
  totalCostPerTraveler: { travelerId: string; total: Money }[];
  groupTotal: Money;
  totalTravelMinutes: number;
  transfers: number;
  satisfaction: number;
  citiesIncluded: string[];
  citiesExcluded: string[];
  priceSources: PriceSource[];
}

export interface RoutePlan {
  /** JSON array of city ids in visiting order, e.g. `["tokyo","seoul"]`. Unique per plan. */
  id: string;
  stops: Stop[];
  intercityLegs: Leg[];
  travelerCosts: TravelerCost[];
  metrics: RouteMetrics;
}

export type AlternativeLabel = "cheapest" | "most_wanted" | "least_travel" | "pareto_alternative";

export interface RouteAlternative {
  labels: AlternativeLabel[];
  route: RoutePlan;
}

export type RouteOptionsResult =
  | {
      ok: true;
      alternatives: RouteAlternative[];
      feasibleCount: number;
      paretoCount: number;
      rejections: RejectionSummary;
      stats: { sequencesEvaluated: number; allocationRuns: number };
    }
  | { ok: false; errors: EngineError[] };
