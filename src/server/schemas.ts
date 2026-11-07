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
  .object({ tripId: z.uuid(), ceilingMinor: minorUnits })
  .strict();

export const removeMemberInput = z.object({ tripId: z.uuid(), userId: z.uuid() }).strict();

export const getTripInput = z.object({ tripId: z.uuid() }).strict();

export function parseInput<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ServiceError("invalid_input", result.error.issues.map((i) => i.message).join("; "));
  }
  return result.data;
}
