import { ServiceError, type ServiceErrorCode } from "@/server";

/** Reads a form field as a string. Files and missing fields become undefined. */
export function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

/** A blank optional field is treated as not given. */
export function optionalField(formData: FormData, name: string): string | undefined {
  const value = field(formData, name)?.trim();
  return value ? value : undefined;
}

const GENERIC: Partial<Record<ServiceErrorCode, string>> = {
  unauthenticated: "Your session has ended. Sign in again.",
  forbidden: "You are not allowed to do that.",
  not_found: "That trip or item could not be found.",
  conflict: "That already exists.",
  internal: "Something went wrong. Try again.",
};

/**
 * Maps a service failure to a short message. invalid_input uses the caller's wording,
 * because the service's own message can read like a schema dump.
 */
export function messageFor(error: unknown, invalidInput: string): string {
  if (!(error instanceof ServiceError)) throw error;
  if (error.code === "invalid_input") return invalidInput;
  return GENERIC[error.code] ?? "Something went wrong. Try again.";
}
