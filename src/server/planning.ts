import { bandCeilingMinor } from "@/domain/budget/bands";
import { ServiceError } from "./errors";
import { requireMember, requireUser } from "./access";
import { parseInput, setOwnBudgetBandInput, setPreferenceInput, suggestDestinationInput } from "./schemas";
import type { BudgetRow, DestinationRow, PreferenceRow, Store } from "./store";

/** `coords` come from the server-side city catalog, never from the request. */
export async function suggestDestination(
  store: Store,
  raw: unknown,
  coords?: { lat: number; lng: number },
): Promise<DestinationRow> {
  const input = parseInput(suggestDestinationInput, raw);
  const userId = await requireUser(store);
  await requireMember(store, input.tripId, userId);
  return store.insertDestination({
    tripId: input.tripId,
    name: input.name,
    suggestedBy: userId,
    ...(coords ? coords : {}),
  });
}

export async function setPreference(store: Store, raw: unknown): Promise<PreferenceRow> {
  const input = parseInput(setPreferenceInput, raw);
  const userId = await requireUser(store);
  await requireMember(store, input.tripId, userId);
  return store.upsertPreference({ ...input, userId });
}

/**
 * Writes the caller's own budget band. There is no way to name another traveler, and the
 * currency and the ceiling are derived here (the trip's currency, the band's top), so a band
 * and a ceiling can never disagree.
 */
export async function setOwnBudgetBand(store: Store, raw: unknown): Promise<BudgetRow> {
  const input = parseInput(setOwnBudgetBandInput, raw);
  const userId = await requireUser(store);
  await requireMember(store, input.tripId, userId);
  const [trip, existing] = await Promise.all([store.getTrip(input.tripId), store.getBudget(input.tripId, userId)]);
  if (!trip) throw new ServiceError("not_found");
  return store.upsertBudget({
    tripId: input.tripId,
    userId,
    band: input.band,
    ceilingMinor: bandCeilingMinor(input.band, trip.baseCurrency),
    currency: trip.baseCurrency,
    flexibilityMinor: existing?.flexibilityMinor ?? null,
  });
}
