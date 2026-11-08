export type ServiceErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_input"
  | "invite_invalid"
  | "already_member"
  | "conflict"
  | "internal";

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;

  /** Set on already_member: the trip the caller already belongs to. */
  readonly tripId?: string;

  constructor(code: ServiceErrorCode, message?: string, tripId?: string) {
    super(message ?? code);
    this.name = "ServiceError";
    this.code = code;
    this.tripId = tripId;
  }
}
