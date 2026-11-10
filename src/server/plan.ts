// Services for the guided plan flow: one read of everything the steps show, and partial
// updates for the coordinator-owned constraint rows.
import { requireCoordinator, requireMember, requireUser } from "./access";
import { setDestinationConstraint, setTripConstraints } from "./constraints";
import { ServiceError } from "./errors";
import {
  getTripInput,
  suggestDestinationInput,
  parseInput,
  updateDestinationConstraintInput,
  updateTripConstraintsInput,
} from "./schemas";
import { MAX_CANDIDATE_CITIES } from "@/domain/engine/validate";
import { checkNewCity } from "@/domain/cities/search";
import { suggestDestination } from "./planning";
import { getTrip, type TripView } from "./trips";
import type {
  AvailabilityRow,
  DestinationRow,
  DestinationConstraintRow,
  FixedEventRow,
  PlanningStore,
  Store,
  TripConstraintsRow,
} from "./store";

type Services = Store & PlanningStore;

export interface PlanView extends TripView {
  constraints: TripConstraintsRow | null;
  destinationConstraints: DestinationConstraintRow[];
  fixedEvents: FixedEventRow[];
  /** The caller's own availability only. Other members' rows are filtered out here. */
  myAvailability: AvailabilityRow | null;
}

/**
 * Everything the plan steps display. Membership is checked by getTrip, which also loads only
 * the caller's own budget; no other budget is ever read.
 */
export async function getPlanView(store: Services, raw: unknown): Promise<PlanView> {
  const { tripId } = parseInput(getTripInput, raw);
  const view = await getTrip(store, { tripId });
  const userId = await requireUser(store);
  const [constraints, destinationConstraints, fixedEvents, availability] = await Promise.all([
    store.getTripConstraints(tripId),
    store.listDestinationConstraints(tripId),
    store.listFixedEvents(tripId),
    store.listAvailability(tripId),
  ]);
  return {
    ...view,
    constraints,
    destinationConstraints,
    fixedEvents,
    myAvailability: availability.find((a) => a.userId === userId) ?? null,
  };
}

const EMPTY_CONSTRAINTS: TripConstraintsRow = {
  departureAirport: null,
  startDestinationId: null,
  endDestinationId: null,
  earliestStart: null,
  latestEnd: null,
  minNights: null,
  maxNights: null,
};

/** Changes only the named fields; the rest keep their saved values. Coordinator only. */
export async function updateTripConstraints(store: Services, raw: unknown): Promise<TripConstraintsRow> {
  const { tripId, ...patch } = parseInput(updateTripConstraintsInput, raw);
  const userId = await requireUser(store);
  await requireCoordinator(store, tripId, userId);
  const current = (await store.getTripConstraints(tripId)) ?? EMPTY_CONSTRAINTS;
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  return setTripConstraints(store, { tripId, ...current, ...defined });
}

/** Changes only the named fields of one city's rules. Coordinator only. */
export async function updateDestinationConstraint(store: Services, raw: unknown): Promise<DestinationConstraintRow> {
  const { tripId, destinationId, ...patch } = parseInput(updateDestinationConstraintInput, raw);
  const userId = await requireUser(store);
  await requireCoordinator(store, tripId, userId);
  const destinations = await store.listDestinations(tripId);
  if (!destinations.some((d) => d.id === destinationId)) throw new ServiceError("not_found");
  const current = (await store.listDestinationConstraints(tripId)).find((c) => c.destinationId === destinationId);
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  return setDestinationConstraint(store, { tripId, ...(current ?? { destinationId }), ...defined, destinationId });
}

/**
 * Adds a candidate city for any member. Refuses duplicates and a list over the engine's cap with
 * a conflict whose message is safe to show.
 */
export async function addCandidateCity(store: Services, raw: unknown): Promise<DestinationRow> {
  const input = parseInput(suggestDestinationInput, raw);
  const userId = await requireUser(store);
  await requireMember(store, input.tripId, userId);
  const existing = await store.listDestinations(input.tripId);
  const problem = checkNewCity(existing.map((d) => d.name), input.name, MAX_CANDIDATE_CITIES);
  if (problem) throw new ServiceError("conflict", problem);
  return suggestDestination(store, input);
}
