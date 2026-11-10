// Safe to import from client components: no server code in this file.

/** Result of a form action: an inline error, or a success flag with an optional one-time value. */
export interface FormState {
  error?: string;
  ok?: boolean;
  /** Shown once after creating an invite link. Never stored client side. */
  inviteLink?: string;
}

export const initialFormState: FormState = {};
