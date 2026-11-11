// Coordinator-only services for confirmed planning constraints and manual quotes, plus the
// member-owned availability write. The database enforces the same rules through row-level
// security; checking the role here gives a clear error instead of a policy failure.
import { nightsBetween } from "@/domain/dates/dates";
import { MAX_TRIP_NIGHTS } from "@/domain/engine/validate";
import { requireCoordinator, requireMember, requireUser } from "./access";
import { ServiceError } from "./errors";
import {
  addFixedEventInput,
  addManualQuoteInput,
  parseInput,
  removeFixedEventInput,
  removeQuoteInput,
  setDestinationConstraintInput,
  setMyAvailabilityInput,
  setTripConstraintsInput,
  setTripDatesInput,
} from "./schemas";
import type {
  DestinationConstraintRow,
  FixedEventRow,
  PlanningStore,
  QuoteRow,
  Store,
  TripConstraintsRow,
} from "./store";

type Services = Store & PlanningStore;

/** Same rule as the engine: the last night of a trip is the one before its end date. */
function eventFitsTrip(e: { startDate: string; endDate: string }, tripStart: string, tripEnd: string): boolean {
  return e.startDate >= tripStart && e.endDate < tripEnd;
}

async function coordinator(store: Services, tripId: string): Promise<string> {
  const userId = await requireUser(store);
  await requireCoordinator(store, tripId, userId);
  return userId;
}

/** Confirmed dates. Both null clears them. */
export async function setTripDates(store: Services, raw: unknown): Promise<void> {
  const input = parseInput(setTripDatesInput, raw);
  await coordinator(store, input.tripId);
  const { startDate, endDate } = input;
  if (startDate !== null && endDate !== null) {
    const nights = nightsBetween(startDate, endDate);
    if (nights < 1 || nights > MAX_TRIP_NIGHTS) {
      throw new ServiceError("invalid_input", `A trip must be 1 to ${MAX_TRIP_NIGHTS} nights; these dates give ${nights}.`);
    }
  }
  // An event is a night slept, so it must start on or after the first day and end before the last.
  for (const e of await store.listFixedEvents(input.tripId)) {
    if (startDate === null || endDate === null || !eventFitsTrip(e, startDate, endDate)) {
      throw new ServiceError(
        "invalid_input",
        `The event "${e.label}" (${e.startDate} to ${e.endDate}) would fall outside these dates. Move or remove it first.`,
      );
    }
  }
  await store.setTripDates(input.tripId, startDate, endDate);
}

/** Replaces the trip's constraint row. Everything in it is optional. */
export async function setTripConstraints(store: Services, raw: unknown): Promise<TripConstraintsRow> {
  const { tripId, ...row } = parseInput(setTripConstraintsInput, raw);
  await coordinator(store, tripId);
  return store.upsertTripConstraints(tripId, row);
}

export async function setDestinationConstraint(store: Services, raw: unknown): Promise<DestinationConstraintRow> {
  const { tripId, ...row } = parseInput(setDestinationConstraintInput, raw);
  await coordinator(store, tripId);
  return store.upsertDestinationConstraint(tripId, row);
}

export async function addFixedEvent(store: Services, raw: unknown): Promise<FixedEventRow> {
  const { tripId, ...event } = parseInput(addFixedEventInput, raw);
  await coordinator(store, tripId);
  const trip = await store.getTrip(tripId);
  if (!trip) throw new ServiceError("not_found");
  if (!trip.startDate || !trip.endDate) {
    throw new ServiceError("invalid_input", "Set the trip dates before adding an event.");
  }
  if (!eventFitsTrip(event, trip.startDate, trip.endDate)) {
    throw new ServiceError(
      "invalid_input",
      `An event must fall on nights of the trip: from ${trip.startDate} up to the night before ${trip.endDate}.`,
    );
  }
  return store.insertFixedEvent(tripId, event);
}

export async function removeFixedEvent(store: Services, raw: unknown): Promise<void> {
  const { tripId, eventId } = parseInput(removeFixedEventInput, raw);
  await coordinator(store, tripId);
  if (!(await store.deleteFixedEvent(tripId, eventId))) throw new ServiceError("not_found");
}

/** A price the coordinator looked up themselves. Always source "manual"; no field can change that. */
export async function addManualQuote(store: Services, raw: unknown): Promise<QuoteRow> {
  const input = parseInput(addManualQuoteInput, raw);
  const userId = await coordinator(store, input.tripId);
  if (input.expiresAt !== null && Date.parse(input.expiresAt) <= Date.now()) {
    throw new ServiceError("invalid_input", "The expiry must be in the future");
  }
  return store.insertManualQuote({
    tripId: input.tripId,
    createdBy: userId,
    kind: input.kind,
    mode: input.mode,
    fromDestinationId: input.kind === "leg" ? input.fromDestinationId : null,
    toDestinationId: input.toDestinationId,
    returnFromDestinationId: input.kind === "long_haul_fare" ? input.returnFromDestinationId : null,
    originAirport: input.originAirport,
    destinationAirport: input.destinationAirport,
    durationMinutes: input.durationMinutes,
    returnMinutes: input.kind === "long_haul_fare" ? input.returnMinutes : null,
    amountMinor: input.amountMinor,
    currency: input.currency,
    expiresAt: input.expiresAt,
  });
}

export async function removeQuote(store: Services, raw: unknown): Promise<void> {
  const { tripId, quoteId } = parseInput(removeQuoteInput, raw);
  await coordinator(store, tripId);
  if (!(await store.deleteQuote(tripId, quoteId))) throw new ServiceError("not_found");
}

/** Replaces the caller's own availability. There is no way to name another member. */
export async function setMyAvailability(store: Services, raw: unknown): Promise<void> {
  const input = parseInput(setMyAvailabilityInput, raw);
  const userId = await requireUser(store);
  await requireMember(store, input.tripId, userId);
  await store.setMyAvailability(input.tripId, input.flexibilityDays, input.ranges);
}
