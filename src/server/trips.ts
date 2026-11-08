import { ServiceError } from "./errors";
import { requireMember, requireUser } from "./access";
import { requireCoordinator } from "./access";
import { createTripInput, getTripInput, parseInput, removeMemberInput } from "./schemas";
import type {
  BudgetRow,
  DestinationRow,
  MemberRow,
  PreferenceRow,
  Role,
  Store,
  TripRow,
  TripSummary,
} from "./store";

/** The caller's own trips. Needs a signed-in user and takes no input. */
export async function listMyTrips(store: Store): Promise<TripSummary[]> {
  const userId = await requireUser(store);
  return store.listMyTrips(userId);
}

export async function createTrip(store: Store, raw: unknown): Promise<{ tripId: string }> {
  const input = parseInput(createTripInput, raw);
  await requireUser(store);
  // The database function makes the caller the coordinator. The role is not an input.
  const tripId = await store.createTrip(input);
  return { tripId };
}

/** Coordinator only. The coordinator cannot remove themselves. */
export async function removeMember(store: Store, raw: unknown): Promise<void> {
  const { tripId, userId: targetId } = parseInput(removeMemberInput, raw);
  const userId = await requireUser(store);
  await requireCoordinator(store, tripId, userId);
  if (targetId === userId) throw new ServiceError("invalid_input", "The coordinator cannot be removed");
  await store.removeMember(tripId, targetId);
}

export interface TripView {
  trip: TripRow;
  viewerRole: Role;
  members: MemberRow[];
  destinations: DestinationRow[];
  preferences: PreferenceRow[];
  /** The caller's own budget. Other members' budgets are never loaded. */
  myBudget: BudgetRow | null;
}

export async function getTrip(store: Store, raw: unknown): Promise<TripView> {
  const { tripId } = parseInput(getTripInput, raw);
  const userId = await requireUser(store);
  const viewerRole = await requireMember(store, tripId, userId);

  const trip = await store.getTrip(tripId);
  if (!trip) throw new ServiceError("not_found");

  const [members, destinations, preferences, myBudget] = await Promise.all([
    store.listMembers(tripId),
    store.listDestinations(tripId),
    store.listPreferences(tripId),
    store.getBudget(tripId, userId),
  ]);
  return { trip, viewerRole, members, destinations, preferences, myBudget };
}
