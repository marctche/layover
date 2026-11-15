export type EmailSignInState =
  | { step: "email"; error?: string }
  | { step: "code"; email: string; sentAt: number };

export const initialEmailState: EmailSignInState = { step: "email" };

/**
 * On success the action returns where to go instead of calling redirect(): a redirect from a
 * server action to /auth/continue (a route handler) never completes in the browser, because the
 * server resolves it before the new session cookie is applied. The client navigates instead.
 */
export type VerifyState = { error?: string; redirectTo?: string };
