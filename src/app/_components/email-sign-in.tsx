"use client";

import { useActionState, useEffect, useState } from "react";
import { sendCodeAction, verifyCodeAction } from "@/app/sign-in/actions";
import { initialEmailState, type EmailSignInState, type VerifyState } from "@/app/sign-in/state";

const RESEND_SECONDS = 60;

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-base dark:border-zinc-700";
const primaryButton =
  "w-full rounded-md bg-zinc-900 px-4 py-2.5 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900";

export function EmailSignIn({ next }: { next: string }) {
  const [open, setOpen] = useState(false);
  const [state, sendAction, sending] = useActionState<EmailSignInState, FormData>(
    sendCodeAction,
    initialEmailState,
  );
  const [verifyState, verifyAction, verifying] = useActionState<VerifyState, FormData>(verifyCodeAction, {});

  const sentAt = state.step === "code" ? state.sentAt : null;
  const [secondsLeft, setSecondsLeft] = useState(0);
  useEffect(() => {
    if (sentAt === null) return;
    const tick = () => setSecondsLeft(Math.max(0, RESEND_SECONDS - Math.floor((Date.now() - sentAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sentAt]);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-zinc-600 underline dark:text-zinc-400">
        Use email instead
      </button>
    );
  }

  if (state.step === "email") {
    return (
      <form action={sendAction} className="space-y-3">
        <input type="hidden" name="next" value={next} />
        <label className="block text-sm font-medium" htmlFor="email">
          Email address
        </label>
        <input id="email" name="email" type="email" autoComplete="email" required className={inputClass} />
        {state.error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {state.error}
          </p>
        ) : null}
        <button type="submit" disabled={sending} className={primaryButton}>
          {sending ? "Sending..." : "Email me a code"}
        </button>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        If that address can receive email, a sign-in code is on its way. You can also open the link in the same email.
      </p>
      <form action={verifyAction} className="space-y-3">
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="email" value={state.email} />
        <label className="block text-sm font-medium" htmlFor="code">
          6-digit code
        </label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          className={`${inputClass} tracking-widest`}
        />
        {verifyState.error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {verifyState.error}
          </p>
        ) : null}
        <button type="submit" disabled={verifying} className={primaryButton}>
          {verifying ? "Checking..." : "Sign in"}
        </button>
      </form>
      <form action={sendAction}>
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="email" value={state.email} />
        <button
          type="submit"
          disabled={sending || secondsLeft > 0}
          className="text-sm text-zinc-600 underline disabled:no-underline disabled:opacity-60 dark:text-zinc-400"
        >
          {secondsLeft > 0 ? `Send a new code in ${secondsLeft}s` : "Send a new code"}
        </button>
      </form>
    </div>
  );
}
