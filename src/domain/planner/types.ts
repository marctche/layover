// Search planner contracts. The planner is pure: it lists the flight searches to
// run (and the ones to skip) with a reason for each, and never calls a provider.

export interface PlannerCity {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** IATA codes, e.g. ["FCO", "CIA"]. */
  airports: string[];
  minNights: number;
  maxNights?: number;
}

export interface PlannerHome {
  id: string;
  lat: number;
  lng: number;
  /** airports[0] is the primary; the rest are alternates reachable by ground. */
  airports: string[];
}

export interface PlannerFixedEvent {
  cityId: string;
  startDate: string;
  endDate: string;
}

export interface PlannerInput {
  startDate: string;
  endDate: string;
  home: PlannerHome;
  cities: PlannerCity[];
  mustInclude?: string[];
  lockedOrder?: string[];
  startCity?: string;
  endCity?: string;
  /** The order the user typed; always kept for comparison. */
  statedOrder?: string[];
  fixedEvents?: PlannerFixedEvent[];
  /** Default 60. */
  maxSearches?: number;
  /** Billable searches per open-jaw search (default 2: the return leg may need a follow-up call). */
  openJawSearchCost?: number;
}

export type Shape = "corridor" | "cluster" | "loop";
export type Modifier = "anchored" | "mostly_locked" | "wide_open" | "large";

export interface ClassificationFeatures {
  cityCount: number;
  homeToNearestCityKm: number;
  shortestOpenPathKm: number;
  maxPairKm: number;
  linearity: number;
  closedTourKm: number;
}

export interface Classification {
  shape: Shape;
  modifiers: Modifier[];
  longHaul: boolean;
  features: ClassificationFeatures;
  reasons: string[];
}

export interface PlannedLeg {
  from: string[];
  to: string[];
  date: string;
}

export interface PlannedSearch {
  id: string;
  kind: "open_jaw" | "one_way";
  legs: PlannedLeg[];
  purpose: "long_haul" | "intercity" | "exploration";
  fromPlace: string;
  toPlace: string;
  /** Lower runs first. */
  priority: number;
  billableCost: number;
  reason: string;
}

export interface KeptOrder {
  order: string[];
  km: number;
  why: string;
}

export interface SkippedOrders {
  count: number;
  why: string;
}

export interface PlannerError {
  code: string;
  message: string;
  path?: string;
}

export type SearchPlan =
  | {
      ok: true;
      classification: Classification;
      keptOrders: KeptOrder[];
      skippedOrders: SkippedOrders[];
      searches: PlannedSearch[];
      droppedForBudget: PlannedSearch[];
      totalBillable: number;
    }
  | { ok: false; errors: PlannerError[] };
