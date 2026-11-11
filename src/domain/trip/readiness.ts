// Pure helpers for the guided plan flow: trip length and the ready checklist.
import { isValidIsoDate, nightsBetween } from "../dates/dates";
import { MAX_CANDIDATE_CITIES } from "../engine/validate";

/** Nights between two date-only strings, or null when either is missing, invalid or out of order. */
export function tripNights(start: string | null, end: string | null): number | null {
  if (!start || !end || !isValidIsoDate(start) || !isValidIsoDate(end)) return null;
  const n = nightsBetween(start, end);
  return n >= 0 ? n : null;
}

export interface ReadinessInput {
  startDate: string | null;
  endDate: string | null;
  departureAirport: string | null;
  cityCount: number;
  /** How many cities each member has rated, keyed by user id. Scores are not included. */
  ratedCountByMember: { userId: string; name: string; rated: number }[];
  viewerId: string;
  /** The viewer has chosen a budget band. The band itself is never part of this input. */
  hasMyBudget: boolean;
}

export interface ReadinessItem {
  id: "dates" | "airport" | "cities" | "myRatings" | "myBudget";
  label: string;
  done: boolean;
  /** A required item blocks "Compare routes"; the others are your own part. */
  required: boolean;
  /** Why it is not done, or a short status. */
  detail: string;
  /** The plan step that fixes it. */
  step: "dates" | "airport" | "cities" | "must-visit" | "event" | "invite" | "rate" | "budget";
}

export interface MemberProgress {
  userId: string;
  name: string;
  rated: number;
  total: number;
  complete: boolean;
}

export interface Readiness {
  items: ReadinessItem[];
  /** Reasons "Compare routes" cannot run yet. Empty when it can. */
  blockers: string[];
  members: MemberProgress[];
}

export function computeReadiness(input: ReadinessInput): Readiness {
  const nights = tripNights(input.startDate, input.endDate);
  const myRated = input.ratedCountByMember.find((m) => m.userId === input.viewerId)?.rated ?? 0;
  const items: ReadinessItem[] = [
    {
      id: "dates",
      label: "Trip dates",
      done: nights !== null && nights > 0,
      required: true,
      detail: nights !== null && nights > 0 ? `${nights} nights` : "Pick exact start and end dates. A flexible window is not supported yet.",
      step: "dates",
    },
    {
      id: "airport",
      label: "Departure airport",
      done: input.departureAirport !== null,
      required: true,
      detail: input.departureAirport ?? "Set the airport the group leaves from.",
      step: "airport",
    },
    {
      id: "cities",
      label: "At least 2 cities",
      done: input.cityCount >= 2 && input.cityCount <= MAX_CANDIDATE_CITIES,
      required: true,
      detail:
        input.cityCount > MAX_CANDIDATE_CITIES
          ? `${input.cityCount} cities; the limit is ${MAX_CANDIDATE_CITIES}.`
          : `${input.cityCount} of ${MAX_CANDIDATE_CITIES} added`,
      step: "cities",
    },
    {
      id: "myRatings",
      label: "Your ratings",
      done: input.cityCount > 0 && myRated >= input.cityCount,
      required: false,
      detail: `${Math.min(myRated, input.cityCount)} of ${input.cityCount} cities rated`,
      step: "rate",
    },
    {
      id: "myBudget",
      label: "Your budget band",
      done: input.hasMyBudget,
      required: false,
      detail: input.hasMyBudget ? "Chosen" : "Not chosen",
      step: "budget",
    },
  ];
  const blockers = items.filter((i) => i.required && !i.done).map((i) => i.detail);
  const members = input.ratedCountByMember.map((m) => ({
    userId: m.userId,
    name: m.name,
    rated: Math.min(m.rated, input.cityCount),
    total: input.cityCount,
    complete: input.cityCount > 0 && m.rated >= input.cityCount,
  }));
  return { items, blockers, members };
}
