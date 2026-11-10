"use server";

import { revalidatePath } from "next/cache";
import { field, messageFor } from "@/app/_lib/form";
import type { FormState } from "@/app/_lib/form-state";
import { parseMajorToMinor } from "@/domain/money/money";
import {
  ServiceError,
  addCandidateCity,
  addFixedEvent,
  createRequestServices,
  removeFixedEvent,
  setMyAvailability,
  setOwnBudget,
  setPreference,
  setTripDates,
  updateDestinationConstraint,
  updateTripConstraints,
} from "@/server";

// Each action reads raw form values, calls a service (which validates and authorizes), refreshes
// the plan pages and reports failures inline. No role, user id or ownership comes from the form.

const refresh = (tripId: string | undefined) => {
  if (tripId) revalidatePath(`/trips/${tripId}/plan`, "layout");
};

const blankToNull = (value: string | undefined): string | null => {
  const v = value?.trim();
  return v ? v : null;
};

const intOrNull = (value: string | undefined): number | null => {
  const v = value?.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : Number.NaN;
};

async function run(tripId: string | undefined, invalidMessage: string, work: (store: Awaited<ReturnType<typeof createRequestServices>>["store"]) => Promise<unknown>): Promise<FormState> {
  try {
    const { store } = await createRequestServices();
    await work(store);
  } catch (error) {
    // Conflicts here carry a message written for travelers (duplicate city, full list).
    if (error instanceof ServiceError && error.code === "conflict" && error.message !== "conflict") return { error: error.message };
    return { error: messageFor(error, invalidMessage) };
  }
  refresh(tripId);
  return { ok: true };
}

export async function saveDatesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const tripId = field(formData, "tripId");
  return run(tripId, "Check the dates: the end must not be before the start, and both are needed.", (store) =>
    setTripDates(store, { tripId, startDate: blankToNull(field(formData, "startDate")), endDate: blankToNull(field(formData, "endDate")) }),
  );
}

export async function saveAirportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const tripId = field(formData, "tripId");
  const code = blankToNull(field(formData, "airport"))?.toUpperCase() ?? null;
  return run(tripId, "Use the three-letter airport code, for example YYZ.", (store) =>
    updateTripConstraints(store, { tripId, departureAirport: code }),
  );
}

export async function addCityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const tripId = field(formData, "tripId");
  return run(tripId, "Choose a city from the list.", (store) => addCandidateCity(store, { tripId, name: field(formData, "name") }));
}

export async function saveRatingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const tripId = field(formData, "tripId");
  const raw = field(formData, "score");
  return run(tripId, "Choose one of the five options.", (store) =>
    setPreference(store, { tripId, destinationId: field(formData, "destinationId"), score: raw === undefined || raw.trim() === "" ? undefined : Number(raw) }),
  );
}

export async function saveCityRulesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const tripId = field(formData, "tripId");
  return run(tripId, "Nights must be whole numbers, and the maximum cannot be below the minimum.", (store) =>
    updateDestinationConstraint(store, {
      tripId,
      destinationId: field(formData, "destinationId"),
      mustInclude: formData.get("mustInclude") === "on",
      minNights: intOrNull(field(formData, "minNights")) ?? undefined,
      maxNights: intOrNull(field(formData, "maxNights")),
    }),
  );
}

export async function saveEndpointsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const tripId = field(formData, "tripId");
  return run(tripId, "Choose different cities for the start and the end.", (store) =>
    updateTripConstraints(store, {
      tripId,
      startDestinationId: blankToNull(field(formData, "startDestinationId")),
      endDestinationId: blankToNull(field(formData, "endDestinationId")),
    }),
  );
}

export async function addFixedEventAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const tripId = field(formData, "tripId");
  return run(tripId, "Choose a city, give a label and dates, with the end not before the start.", (store) =>
    addFixedEvent(store, {
      tripId,
      destinationId: field(formData, "destinationId"),
      label: field(formData, "label"),
      startDate: field(formData, "startDate"),
      endDate: field(formData, "endDate"),
    }),
  );
}

export async function removeFixedEventAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const tripId = field(formData, "tripId");
  return run(tripId, "That event could not be removed.", (store) => removeFixedEvent(store, { tripId, eventId: field(formData, "eventId") }));
}

export async function saveAvailabilityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const tripId = field(formData, "tripId");
  const starts = formData.getAll("rangeStart").map(String);
  const ends = formData.getAll("rangeEnd").map(String);
  const ranges: { startDate: string; endDate: string }[] = [];
  for (let i = 0; i < Math.max(starts.length, ends.length); i++) {
    const startDate = starts[i]?.trim() ?? "";
    const endDate = ends[i]?.trim() ?? "";
    if (!startDate && !endDate) continue;
    if (!startDate || !endDate) return { error: "Fill in both dates of each range, or clear both." };
    ranges.push({ startDate, endDate });
  }
  const flex = intOrNull(field(formData, "flexibilityDays"));
  return run(tripId, "Check the ranges and use 0 to 60 flexible days.", (store) =>
    setMyAvailability(store, { tripId, flexibilityDays: flex ?? 0, ranges }),
  );
}

export async function saveBudgetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const tripId = field(formData, "tripId");
  const currency = field(formData, "currency") ?? "";
  const minor = parseMajorToMinor(field(formData, "ceiling") ?? "", currency);
  if (minor === null) return { error: "Enter your budget as a plain amount, for example 1800 or 1800.50." };
  return run(tripId, "That budget is not valid.", (store) => setOwnBudget(store, { tripId, ceilingMinor: minor }));
}
