// Coordinator-only services for confirmed planning constraints and manual quotes, plus the
// member-owned availability write. The database enforces the same rules through row-level
// security; checking the role here gives a clear error instead of a policy failure.
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

async function coordinator(store: Services, tripId: string): Promise<string> {
  const userId = await requireUser(store);
  await requireCoordinator(store, tripId, userId);
  return userId;
}

/** Confirmed dates. Both null clears them. */
export async function setTripDates(store: Services, raw: unknown): Promise<void> {
  const input = parseInput(setTripDatesInput, raw);
  await coordinator(store, input.tripId);
  await store.setTripDates(input.tripId, input.startDate, input.endDate);
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
