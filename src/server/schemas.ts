import { z } from "zod";
import { ServiceError } from "./errors";

// Inputs never carry a user id or a role. Identity comes from the session,
// and .strict() rejects any extra claim a client tries to add.

const currency = z.string().regex(/^[A-Z]{3}$/, "Use a three-letter currency code");
const minorUnits = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const createTripInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    startDate: z.iso.date().optional(),
    endDate: z.iso.date().optional(),
    groupTargetMinor: minorUnits.optional(),
    baseCurrency: currency,
  })
  .strict()
  .refine((v) => (v.startDate === undefined) === (v.endDate === undefined), {
    message: "Give both dates or neither",
    path: ["endDate"],
  })
  .refine((v) => v.startDate === undefined || v.endDate === undefined || v.endDate >= v.startDate, {
    message: "End date is before start date",
    path: ["endDate"],
  });

export const createInviteInput = z
  .object({
    tripId: z.uuid(),
    expiresInDays: z.number().int().min(1).max(90).default(14),
  })
  .strict();

export const revokeInviteInput = z.object({ inviteId: z.uuid() }).strict();

export const joinWithInviteInput = z
  .object({ token: z.string().min(32).max(256) })
  .strict();

export const suggestDestinationInput = z
  .object({ tripId: z.uuid(), name: z.string().trim().min(1).max(100) })
  .strict();

export const setPreferenceInput = z
  .object({
    tripId: z.uuid(),
    destinationId: z.uuid(),
    score: z.number().int().min(-2).max(2),
  })
  .strict();

export const setOwnBudgetInput = z
  .object({
    tripId: z.uuid(),
    ceilingMinor: minorUnits,
    /** Defaults to the trip currency. Stored as entered, never converted. */
    currency: currency.optional(),
    /** How far above the ceiling the traveler would stretch. Private, like the ceiling. */
    flexibilityMinor: minorUnits.nullable().optional(),
  })
  .strict();

export const removeMemberInput = z.object({ tripId: z.uuid(), userId: z.uuid() }).strict();

export const getTripInput = z.object({ tripId: z.uuid() }).strict();

// Planning constraints, quotes and scenarios.

const isoDate = z.iso.date();
const airport = z.string().regex(/^[A-Z]{3}$/, "Use a three-letter airport code");
const nights = z.number().int().min(1).max(365);

export const setTripDatesInput = z
  .object({ tripId: z.uuid(), startDate: isoDate.nullable(), endDate: isoDate.nullable() })
  .strict()
  .refine((v) => (v.startDate === null) === (v.endDate === null), { message: "Give both dates or neither", path: ["endDate"] })
  .refine((v) => v.startDate === null || v.endDate === null || v.endDate >= v.startDate, {
    message: "End date is before start date",
    path: ["endDate"],
  });

/** Replaces the whole row: a field left out is cleared. */
export const setTripConstraintsInput = z
  .object({
    tripId: z.uuid(),
    departureAirport: airport.nullable().default(null),
    startDestinationId: z.uuid().nullable().default(null),
    endDestinationId: z.uuid().nullable().default(null),
    earliestStart: isoDate.nullable().default(null),
    latestEnd: isoDate.nullable().default(null),
    minNights: nights.nullable().default(null),
    maxNights: nights.nullable().default(null),
  })
  .strict()
  .refine((v) => v.earliestStart === null || v.latestEnd === null || v.latestEnd > v.earliestStart, {
    message: "The latest end must be after the earliest start",
    path: ["latestEnd"],
  })
  .refine((v) => v.minNights === null || v.maxNights === null || v.maxNights >= v.minNights, {
    message: "Maximum nights is below minimum nights",
    path: ["maxNights"],
  })
  .refine((v) => v.startDestinationId === null || v.startDestinationId !== v.endDestinationId, {
    message: "The start and end city must differ",
    path: ["endDestinationId"],
  });

/** Replaces the destination's row: a field left out returns to its default. */
export const setDestinationConstraintInput = z
  .object({
    tripId: z.uuid(),
    destinationId: z.uuid(),
    minNights: nights.default(1),
    maxNights: nights.nullable().default(null),
    mustInclude: z.boolean().default(false),
    lockPosition: z.number().int().min(1).max(100).nullable().default(null),
  })
  .strict()
  .refine((v) => v.maxNights === null || v.maxNights >= v.minNights, {
    message: "Maximum nights is below minimum nights",
    path: ["maxNights"],
  });

export const addFixedEventInput = z
  .object({
    tripId: z.uuid(),
    destinationId: z.uuid(),
    label: z.string().trim().min(1).max(120),
    startDate: isoDate,
    endDate: isoDate,
  })
  .strict()
  .refine((v) => v.endDate >= v.startDate, { message: "End date is before start date", path: ["endDate"] });

export const removeFixedEventInput = z.object({ tripId: z.uuid(), eventId: z.uuid() }).strict();

const quoteBase = {
  tripId: z.uuid(),
  mode: z.enum(["flight", "train", "bus"]),
  originAirport: airport.nullable().default(null),
  destinationAirport: airport.nullable().default(null),
  durationMinutes: z.number().int().min(1).max(100_000),
  amountMinor: minorUnits,
  currency,
  /** Quotes do not need to expire; when they do, it must be in the future. */
  expiresAt: z.iso.datetime().nullable().default(null),
};

// There is no `source` and no `adults` field: this service writes manual, one-adult quotes only.
export const addManualQuoteInput = z.discriminatedUnion("kind", [
  z
    .object({
      ...quoteBase,
      kind: z.literal("leg"),
      /** Null means the traveler's home. At least one end names a destination. */
      fromDestinationId: z.uuid().nullable().default(null),
      toDestinationId: z.uuid().nullable().default(null),
    })
    .strict()
    .refine((v) => v.fromDestinationId !== null || v.toDestinationId !== null, {
      message: "A leg needs at least one destination",
      path: ["toDestinationId"],
    })
    .refine((v) => v.fromDestinationId !== v.toDestinationId, { message: "A leg cannot start and end in one place", path: ["toDestinationId"] }),
  z
    .object({
      ...quoteBase,
      kind: z.literal("long_haul_fare"),
      mode: z.literal("flight"),
      toDestinationId: z.uuid(),
      returnFromDestinationId: z.uuid(),
      returnMinutes: z.number().int().min(1).max(100_000),
    })
    .strict(),
]);

export const removeQuoteInput = z.object({ tripId: z.uuid(), quoteId: z.uuid() }).strict();

export const setMyAvailabilityInput = z
  .object({
    tripId: z.uuid(),
    flexibilityDays: z.number().int().min(0).max(60).default(0),
    ranges: z
      .array(
        z
          .object({ startDate: isoDate, endDate: isoDate })
          .strict()
          .refine((r) => r.endDate >= r.startDate, { message: "End date is before start date" }),
      )
      .max(20),
  })
  .strict();

export const tripScopedInput = z.object({ tripId: z.uuid() }).strict();

export function parseInput<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ServiceError("invalid_input", result.error.issues.map((i) => i.message).join("; "));
  }
  return result.data;
}

// Partial updates for the guided plan flow. The service merges these into the saved row, so a
// step that edits one field does not clear the others. The merged row is validated again with
// the full schemas above.

export const updateTripConstraintsInput = z
  .object({
    tripId: z.uuid(),
    departureAirport: airport.nullable().optional(),
    startDestinationId: z.uuid().nullable().optional(),
    endDestinationId: z.uuid().nullable().optional(),
    earliestStart: isoDate.nullable().optional(),
    latestEnd: isoDate.nullable().optional(),
    minNights: nights.nullable().optional(),
    maxNights: nights.nullable().optional(),
  })
  .strict();

export const updateDestinationConstraintInput = z
  .object({
    tripId: z.uuid(),
    destinationId: z.uuid(),
    minNights: nights.optional(),
    maxNights: nights.nullable().optional(),
    mustInclude: z.boolean().optional(),
    lockPosition: z.number().int().min(1).max(100).nullable().optional(),
  })
  .strict();
