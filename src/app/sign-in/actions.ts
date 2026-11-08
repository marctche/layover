"use server";

import { redirect } from "next/navigation";
import { requestOrigin } from "@/app/_lib/request";
import {
  createRequestServices,
  ServiceError,
  signInWithMagicLink,
  startGoogleSignIn,
  verifyEmailCode,
} from "@/server";
import type { EmailSignInState, VerifyState } from "./state";

const text = (value: FormDataEntryValue | null): string | undefined => (typeof value === "string" ? value : undefined);

export async function googleSignInAction(formData: FormData): Promise<void> {
  const next = text(formData.get("next"));
  let url: string;
  try {
    const { auth } = await createRequestServices();
    url = await startGoogleSignIn(auth, await requestOrigin(), { next });
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error;
    redirect("/sign-in?error=google");
  }
  redirect(url);
}

export async function sendCodeAction(_prev: EmailSignInState, formData: FormData): Promise<EmailSignInState> {
  const email = text(formData.get("email"))?.trim() ?? "";
  try {
    const { auth } = await createRequestServices();
    await signInWithMagicLink(auth, await requestOrigin(), { email, next: text(formData.get("next")) });
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error;
    if (error.code === "invalid_input") return { step: "email", error: "Enter a valid email address." };
    return { step: "email", error: "We could not send a code right now. Try again in a minute." };
  }
  return { step: "code", email, sentAt: Date.now() };
}

export async function verifyCodeAction(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  try {
    const { auth } = await createRequestServices();
    await verifyEmailCode(auth, { email: text(formData.get("email")) ?? "", code: text(formData.get("code")) ?? "" });
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error;
    const message =
      error.code === "invalid_input"
        ? "Enter the 6-digit code from the email."
        : "That code did not work. Check it, or send a new one.";
    return { error: message };
  }
  redirect(`/auth/continue?next=${encodeURIComponent(text(formData.get("next")) ?? "")}`);
}
