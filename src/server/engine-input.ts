// Turns a saved trip into the route engine's input. Pure: rows in, TripInput out, so the
// mapping is unit tested without a database and the engine never sees a guessed value.
import { createHash } from "node:crypto";
import { money } from "@/domain/money/money";
import type { CityCosts, Leg, LongHaulFare, Quote, Traveler, TripInput } from "@/domain/trip/types";
import type {
  DestinationConstraintRow,
  DestinationRow,
  FixedEventRow,
  MemberRow,
  PreferenceRow,
  QuoteRow,
  TripConstraintsRow,
  TripRow,
} from "./store";

/** Bump when the engine's behaviour changes, so saved runs are not reused across versions. */
export const ENGINE_VERSION = "2026-11-10.1";

/** The one home every traveler departs from. Per-member home airports are stored but not mapped yet. */
export const HOME_ID = "home";

/** Lodging and daily costs have no data source yet; they enter as zero, labelled synthetic. */
export const CITY_COSTS_PROVIDER = "not-entered";

/**
 * Everything the engine input is built from. There is deliberately no budget field:
 * budget ceilings are private to their owner, and how the engine may use them is an open
 * decision (A: a SQL function that returns only fit and headroom; B: secret key plus
 * redaction). Until then scenarios are budget-free.
 */
export interface EngineSnapshot {
  trip: TripRow;
  constraints: TripConstraintsRow | null;
  members: MemberRow[];
  destinations: DestinationRow[];
  destinationConstraints: DestinationConstraintRow[];
  fixedEvents: FixedEventRow[];
  preferences: PreferenceRow[];
  quotes: QuoteRow[];
}

export type EngineInputIssue =
  | { code: "missing_dates"; message: string; missing: string[] }
  | { code: "flexible_dates_unsupported"; message: string }
  | { code: "no_destinations"; message: string };

export type QuoteExclusionReason = "expired" | "currency_mismatch" | "adults_not_one";

export interface ExcludedQuote {
  quoteId: string;
  reason: QuoteExclusionReason;
}

export type EngineInputResult =
  | { ok: true; input: TripInput; excludedQuotes: ExcludedQuote[] }
  | { ok: false; issues: EngineInputIssue[] };

function dateIssues(trip: TripRow, c: TripConstraintsRow | null): EngineInputIssue[] {
  if (trip.startDate && trip.endDate) return [];
  const missing: string[] = [];
  if (!c?.earliestStart) missing.push("earliest_start");
  if (!c?.latestEnd) missing.push("latest_end");
  if (c?.minNights == null) missing.push("min_nights");
  if (c?.maxNights == null) missing.push("max_nights");
  if (missing.length === 0) {
    // A window plus a duration is stored, but the engine plans one fixed date range.
    return [
      {
        code: "flexible_dates_unsupported",
        message: "The trip has an approximate window and length but no confirmed dates; route generation needs confirmed start and end dates.",
      },
    ];
  }
  return [
    {
      code: "missing_dates",
      message: "Set confirmed start and end dates, or an approximate window (earliest start, latest end) and a length (minimum and maximum nights).",
      missing: ["confirmed_dates", ...missing],
    },
  ];
}

const byKey = <T>(key: (t: T) => string) => (a: T, b: T) => {
  const x = key(a);
  const y = key(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

export function buildEngineInput(snap: EngineSnapshot, now: Date): EngineInputResult {
  const { trip, constraints } = snap;
  const issues = dateIssues(trip, constraints);
  if (snap.destinations.length === 0) {
    issues.push({ code: "no_destinations", message: "Add at least one destination." });
  }

  if (issues.length > 0) return { ok: false, issues };

  const currency = trip.baseCurrency;
  const stayOf = new Map(snap.destinationConstraints.map((d) => [d.destinationId, d]));
  const cities = snap.destinations
    .map((d) => {
      const stay = stayOf.get(d.id);
      const city: TripInput["cities"][number] = { id: d.id, name: d.name, minNights: stay?.minNights ?? 1 };
      if (stay?.maxNights != null) city.maxNights = stay.maxNights;
      if (d.lat != null && d.lng != null) {
        city.lat = d.lat;
        city.lng = d.lng;
      }
      return city;
    })
    .sort(byKey((c) => c.id));

  // Budget plug-in point: `budgetCeiling` is never set here. See EngineSnapshot.
  const travelers: Traveler[] = snap.members
    .map((m) => ({ id: m.userId, name: m.displayName.trim() || "Traveler", home: HOME_ID }))
    .sort(byKey((t) => t.id));

  const excludedQuotes: ExcludedQuote[] = [];
  const legs: Leg[] = [];
  const longHaulFares: LongHaulFare[] = [];
  for (const q of snap.quotes) {
    const reason: QuoteExclusionReason | null =
      q.expiresAt !== null && Date.parse(q.expiresAt) <= now.getTime()
        ? "expired"
        : q.currency !== currency
          ? "currency_mismatch"
          : q.adults !== 1
            ? "adults_not_one"
            : null;
    if (reason) {
      excludedQuotes.push({ quoteId: q.id, reason });
      continue;
    }
    const price: Quote = { price: money(q.amountMinor, q.currency), source: q.source, fetchedAt: q.fetchedAt };
    if (q.provider !== null) price.provider = q.provider;
    if (q.kind === "leg") {
      legs.push({
        from: q.fromDestinationId ?? HOME_ID,
        to: q.toDestinationId ?? HOME_ID,
        mode: q.mode,
        durationMinutes: q.durationMinutes,
        pricePerPerson: price,
      });
    } else {
      longHaulFares.push({
        home: HOME_ID,
        outboundTo: q.toDestinationId as string,
        returnFrom: q.returnFromDestinationId as string,
        outboundMinutes: q.durationMinutes,
        returnMinutes: q.returnMinutes as number,
        pricePerPerson: price,
      });
    }
  }

  const zero = (): Quote => ({ price: money(0, currency), source: "synthetic", provider: CITY_COSTS_PROVIDER });
  const cityCosts: CityCosts[] = cities.map((c) => ({
    cityId: c.id,
    lodgingPerPersonPerNight: zero(),
    dailySpendPerPerson: zero(),
  }));

  const input: TripInput = {
    currency,
    startDate: trip.startDate as string,
    endDate: trip.endDate as string,
    cities,
    travelers,
    legs: legs.sort(byKey(canonicalJson)),
    longHaulFares: longHaulFares.sort(byKey(canonicalJson)),
    cityCosts,
    fixedEvents: snap.fixedEvents
      .map((e) => ({ id: e.id, cityId: e.destinationId, startDate: e.startDate, endDate: e.endDate, label: e.label }))
      .sort(byKey((e) => e.id)),
    preferences: snap.preferences
      .map((p) => ({ travelerId: p.userId, cityId: p.destinationId, score: p.score as -2 | -1 | 0 | 1 | 2 }))
      .sort(byKey((p) => JSON.stringify([p.travelerId, p.cityId]))),
  };

  // The engine plans exactly the accepted set. Destinations have no accepted/rejected status
  // yet, so every trip destination counts as accepted and is required. Real accept/reject
  // arrives with city-addition votes. mustInclude keeps only the user's real must-visit flags,
  // so an accepted city can still be dropped but a must-visit one cannot.
  input.accepted = cities.map((c) => c.id);
  const mustVisit = snap.destinationConstraints
    .filter((d) => d.mustInclude)
    .map((d) => d.destinationId)
    .sort();
  if (mustVisit.length > 0) input.mustInclude = mustVisit;
  const locked = snap.destinationConstraints
    .filter((d) => d.lockPosition !== null)
    .sort((a, b) => (a.lockPosition as number) - (b.lockPosition as number))
    .map((d) => d.destinationId);
  if (locked.length > 0) input.lockedOrder = locked;
  if (constraints?.startDestinationId) input.startCity = constraints.startDestinationId;
  if (constraints?.endDestinationId) input.endCity = constraints.endDestinationId;

  // Stored but not read by the engine yet: per-member availability and flexibility, the
  // approximate window and length, per-member home airports and the departure airport
  // label, and budget flexibility (budgets themselves are never loaded, see EngineSnapshot).
  excludedQuotes.sort(byKey((e) => e.quoteId));
  return { ok: true, input, excludedQuotes };
}

/** Recursively sorts object keys so equal inputs always serialise identically. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return v;
  });
}

/** SHA-256 of the canonical input. Arrays are already in a fixed order from buildEngineInput. */
export function hashEngineInput(input: TripInput): string {
  return createHash("sha256").update(canonicalJson(input), "utf8").digest("hex");
}
