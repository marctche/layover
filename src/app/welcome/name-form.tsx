"use client";

import { useActionState } from "react";
import { saveNameAction, type WelcomeState } from "./actions";

export function NameForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<WelcomeState, FormData>(saveNameAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <label className="block text-sm font-medium" htmlFor="displayName">
        What should your group call you?
      </label>
      <input
        id="displayName"
        name="displayName"
        type="text"
        autoComplete="nickname"
        required
        maxLength={80}
        className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-base dark:border-zinc-700"
      />
      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-zinc-900 px-4 py-2.5 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
      >
        {pending ? "Saving..." : "Continue"}
      </button>
    </form>
  );
}
