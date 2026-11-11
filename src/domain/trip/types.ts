import type { CurrencyCode, Money } from "../money/money";

export type PriceSource = "live" | "manual" | "estimate" | "synthetic";

export interface Quote {
  price: Money;
  source: PriceSource;
  provider?: string;
  fetchedAt?: string;
}

export interface City {
  id: string;
  name: string;
  minNights: number;
  maxNights?: number;
}

/** Directed. `from` and `to` are city ids or traveler home-airport ids. */
export interface Leg {
  from: string;
  to: string;
  mode: "flight" | "train" | "bus";
  durationMinutes: number;
  pricePerPerson: Quote;
}

export interface Traveler {
  id: string;
  name: string;
  /** Home-airport id; international legs run between this and a city. */
  home: string;
  /** Private. Never copy into another traveler's fields. */
  budgetCeiling?: Money;
}

/** The group must sleep in `cityId` on every night from startDate through endDate inclusive. */
export interface FixedEvent {
  id: string;
  cityId: string;
  startDate: string;
  endDate: string;
  label: string;
}

export interface CityCosts {
  cityId: string;
  lodgingPerPersonPerNight: Quote;
  dailySpendPerPerson: Quote;
}

export interface Preference {
  travelerId: string;
  cityId: string;
  score: -2 | -1 | 0 | 1 | 2;
}

/**
 * One long-haul ticket covering both directions: home to `outboundTo` at the
 * start of the trip, `returnFrom` to home at the end (open-jaw when they differ).
 */
export interface LongHaulFare {
  /** Traveler home id. */
  home: string;
  /** City id flown into at trip start. */
  outboundTo: string;
  /** City id flown home from at trip end. May equal outboundTo only on a one-city route. */
  returnFrom: string;
  outboundMinutes: number;
  returnMinutes: number;
  /** Price of the whole ticket, both directions. */
  pricePerPerson: Quote;
}

export interface TripInput {
  currency: CurrencyCode;
  startDate: string;
  endDate: string;
  cities: City[];
  travelers: Traveler[];
  legs: Leg[];
  /** Optional round-trip / open-jaw tickets, priced against the one-way pair per traveler. */
  longHaulFares?: LongHaulFare[];
  cityCosts: CityCosts[];
  fixedEvents: FixedEvent[];
  preferences: Preference[];
  /** Cities the user flagged as must-visit. Cannot be dropped, even to explain an infeasible plan. */
  mustInclude?: string[];
  /**
   * The accepted set: cities the route must visit, but which the group may still choose to drop.
   * Required in every route like mustInclude, but simulateChange "remove" and dropOptions allow
   * removing them.
   */
  accepted?: string[];
  /** Required cities that must appear in exactly this relative order; others may sit between. */
  lockedOrder?: string[];
  /** Route must begin here (implies required). */
  startCity?: string;
  /** Route must end here (implies required). */
  endCity?: string;
  maxAlternatives?: number;
}
