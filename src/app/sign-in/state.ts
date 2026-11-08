export type EmailSignInState =
  | { step: "email"; error?: string }
  | { step: "code"; email: string; sentAt: number };

export const initialEmailState: EmailSignInState = { step: "email" };

export type VerifyState = { error?: string };
