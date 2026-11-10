"use server";

import { redirect } from "next/navigation";
import { field, messageFor, optionalField } from "@/app/_lib/form";
import type { FormState } from "@/app/_lib/form-state";
import { parseMajorToMinor } from "@/domain/money/money";
import { createRequestServices, createTrip } from "@/server";

export async function createTripAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const baseCurrency = (optionalField(formData, "baseCurrency") ?? "CAD").toUpperCase();
  const target = optionalField(formData, "groupTarget");
  let groupTargetMinor: number | undefined;
  if (target !== undefined) {
    const minor = /^[A-Z]{3}$/.test(baseCurrency) ? parseMajorToMinor(target, baseCurrency) : null;
    if (minor === null) return { error: "Enter the group target as a plain amount, for example 2500 or 2500.50." };
    groupTargetMinor = minor;
  }

  let tripId: string;
  try {
    const { store } = await createRequestServices();
    ({ tripId } = await createTrip(store, {
      name: field(formData, "name"),
      startDate: optionalField(formData, "startDate"),
      endDate: optionalField(formData, "endDate"),
      groupTargetMinor,
      baseCurrency,
    }));
  } catch (error) {
    return {
      error: messageFor(
        error,
        "Check the trip: it needs a name, a three-letter currency, both dates or neither, and an end date on or after the start.",
      ),
    };
  }
  redirect(`/trips/${tripId}`);
}
