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

export interface TripInput {
  currency: CurrencyCode;
  startDate: string;
  endDate: string;
  cities: City[];
  travelers: Traveler[];
  legs: Leg[];
  cityCosts: CityCosts[];
  fixedEvents: FixedEvent[];
  preferences: Preference[];
  mustInclude?: string[];
  maxAlternatives?: number;
}
