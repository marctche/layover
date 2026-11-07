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

  constructor(code: ServiceErrorCode, message?: string) {
    super(message ?? code);
    this.name = "ServiceError";
    this.code = code;
  }
}
