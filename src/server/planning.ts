import { ServiceError } from "./errors";
import { requireMember, requireUser } from "./access";
import { parseInput, setOwnBudgetInput, setPreferenceInput, suggestDestinationInput } from "./schemas";
import type { BudgetRow, DestinationRow, PreferenceRow, Store } from "./store";

export async function suggestDestination(store: Store, raw: unknown): Promise<DestinationRow> {
  const input = parseInput(suggestDestinationInput, raw);
  const userId = await requireUser(store);
  await requireMember(store, input.tripId, userId);
  return store.insertDestination({ tripId: input.tripId, name: input.name, suggestedBy: userId });
}

export async function setPreference(store: Store, raw: unknown): Promise<PreferenceRow> {
  const input = parseInput(setPreferenceInput, raw);
  const userId = await requireUser(store);
  await requireMember(store, input.tripId, userId);
  return store.upsertPreference({ ...input, userId });
}

/** Writes the caller's own budget. There is no way to name another traveler. */
export async function setOwnBudget(store: Store, raw: unknown): Promise<BudgetRow> {
  const input = parseInput(setOwnBudgetInput, raw);
  const userId = await requireUser(store);
  await requireMember(store, input.tripId, userId);
  // Fields not named keep the caller's saved values; a first write falls back to the trip currency.
  const [trip, existing] = await Promise.all([store.getTrip(input.tripId), store.getBudget(input.tripId, userId)]);
  if (!trip) throw new ServiceError("not_found");
  return store.upsertBudget({
    tripId: input.tripId,
    userId,
    ceilingMinor: input.ceilingMinor,
    // A currency different from the trip's is kept as entered, never converted.
    currency: input.currency ?? existing?.currency ?? trip.baseCurrency,
    flexibilityMinor: input.flexibilityMinor === undefined ? (existing?.flexibilityMinor ?? null) : input.flexibilityMinor,
  });
}
