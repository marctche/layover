"use server";

import { revalidatePath } from "next/cache";
import { field, messageFor } from "@/app/_lib/form";
import type { FormState } from "@/app/_lib/form-state";
import { requestOrigin } from "@/app/_lib/request";
import { parseMajorToMinor } from "@/domain/money/money";
import {
  createInvite,
  createRequestServices,
  removeMember,
  revokeInvite,
  setOwnBudget,
  setPreference,
  suggestDestination,
} from "@/server";

// Each action reads raw form values, calls the service (which validates and authorizes),
// refreshes the page and reports failures inline. No role or ownership comes from the form.

const refresh = (tripId: string | undefined) => {
  if (tripId) revalidatePath(`/trips/${tripId}`);
};

export async function suggestDestinationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const tripId = field(formData, "tripId");
  try {
    const { store } = await createRequestServices();
    await suggestDestination(store, { tripId, name: field(formData, "name") });
  } catch (error) {
    return { error: messageFor(error, "Enter a city name of up to 100 characters.") };
  }
  refresh(tripId);
  return { ok: true };
}

export async function setPreferenceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const tripId = field(formData, "tripId");
  const raw = field(formData, "score");
  try {
    const { store } = await createRequestServices();
    await setPreference(store, {
      tripId,
      destinationId: field(formData, "destinationId"),
      score: raw === undefined || raw.trim() === "" ? undefined : Number(raw),
    });
  } catch (error) {
    return { error: messageFor(error, "Choose one of the five options.") };
  }
  refresh(tripId);
  return { ok: true };
}

export async function setBudgetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const tripId = field(formData, "tripId");
  const currency = field(formData, "currency") ?? "";
  const minor = parseMajorToMinor(field(formData, "ceiling") ?? "", currency);
  if (minor === null) return { error: "Enter your budget as a plain amount, for example 1800 or 1800.50." };
  try {
    const { store } = await createRequestServices();
    await setOwnBudget(store, { tripId, ceilingMinor: minor });
  } catch (error) {
    return { error: messageFor(error, "That budget is not valid.") };
  }
  refresh(tripId);
  return { ok: true };
}

export async function createInviteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const tripId = field(formData, "tripId");
  let link: string;
  try {
    const { store } = await createRequestServices();
    const { token } = await createInvite(store, { tripId });
    link = `${await requestOrigin()}/join/${token}`;
  } catch (error) {
    return { error: messageFor(error, "Could not create an invite for this trip.") };
  }
  refresh(tripId);
  return { ok: true, inviteLink: link };
}

export async function revokeInviteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { store } = await createRequestServices();
    await revokeInvite(store, { inviteId: field(formData, "inviteId") });
  } catch (error) {
    return { error: messageFor(error, "That invite could not be revoked.") };
  }
  refresh(field(formData, "tripId"));
  return { ok: true };
}

export async function removeMemberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const tripId = field(formData, "tripId");
  try {
    const { store } = await createRequestServices();
    await removeMember(store, { tripId, userId: field(formData, "userId") });
  } catch (error) {
    return { error: messageFor(error, "That member could not be removed.") };
  }
  refresh(tripId);
  return { ok: true };
}
