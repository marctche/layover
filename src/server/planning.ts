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
  return store.upsertBudget({ ...input, userId });
}
