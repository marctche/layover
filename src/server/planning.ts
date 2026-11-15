import { bandForAmount } from "@/domain/budget/bands";
import { ServiceError } from "./errors";
import { requireMember, requireUser } from "./access";
import { getMemberBandsInput, parseInput, setOwnBudgetAmountInput, setPreferenceInput, suggestDestinationInput } from "./schemas";
import type { BudgetRow, MemberBand, DestinationRow, PreferenceRow, Store } from "./store";

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
 * Writes the caller's own exact budget. There is no way to name another traveler. The currency
 * is the trip's and the band is derived here from the amount (the database derives it again,
 * so the two can never disagree).
 */
export async function setOwnBudgetAmount(store: Store, raw: unknown): Promise<BudgetRow> {
  const input = parseInput(setOwnBudgetAmountInput, raw);
  const userId = await requireUser(store);
  await requireMember(store, input.tripId, userId);
  const [trip, existing] = await Promise.all([store.getTrip(input.tripId), store.getBudget(input.tripId, userId)]);
  if (!trip) throw new ServiceError("not_found");
  return store.upsertBudget({
    tripId: input.tripId,
    userId,
    band: bandForAmount(input.amountMinor, trip.baseCurrency),
    ceilingMinor: input.amountMinor,
    currency: trip.baseCurrency,
    flexibilityMinor: existing?.flexibilityMinor ?? null,
  });
}

/**
 * The band each member who has set a budget falls in, for any member of the trip. This is the
 * only budget information the group sees: the amount stays with its owner.
 */
export async function getMemberBands(store: Store, raw: unknown): Promise<MemberBand[]> {
  const input = parseInput(getMemberBandsInput, raw);
  const userId = await requireUser(store);
  await requireMember(store, input.tripId, userId);
  return store.getMemberBands(input.tripId);
}
