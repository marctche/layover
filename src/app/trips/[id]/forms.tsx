"use client";

import { useActionState, useState } from "react";
import { initialFormState, type FormState } from "@/app/_lib/form-state";
import {
  createInviteAction,
  removeMemberAction,
  revokeInviteAction,
  setPreferenceAction,
  suggestDestinationAction,
} from "./actions";

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-base dark:border-zinc-700";
const primaryButton =
  "rounded-md bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900";
const linkButton = "text-sm text-zinc-600 underline disabled:opacity-50 dark:text-zinc-400";

function ErrorText({ state }: { state: FormState }) {
  return state.error ? (
    <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
      {state.error}
    </p>
  ) : null;
}

export const SCORE_LABELS: Record<number, string> = {
  [-2]: "Rather not",
  [-1]: "Lean no",
  0: "Neutral",
  1: "Lean yes",
  2: "Must go",
};

export function AddCityForm({ tripId }: { tripId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(suggestDestinationAction, initialFormState);
  return (
    <form action={action} className="mt-4">
      <input type="hidden" name="tripId" value={tripId} />
      <label htmlFor="city-name" className="block text-sm font-medium">
        Add a city
      </label>
      <div className="mt-1 flex gap-2">
        <input id="city-name" name="name" required maxLength={100} className={inputClass} />
        <button type="submit" disabled={pending} className={primaryButton}>
          Add
        </button>
      </div>
      <ErrorText state={state} />
    </form>
  );
}

/** Five submit buttons in one form. The pressed one carries the score. */
export function ScoreControl({
  tripId,
  destinationId,
  destinationName,
  current,
}: {
  tripId: string;
  destinationId: string;
  destinationName: string;
  current: number | null;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(setPreferenceAction, initialFormState);
  return (
    <form action={action}>
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="destinationId" value={destinationId} />
      <fieldset disabled={pending}>
        <legend className="sr-only">Your score for {destinationName}</legend>
        <div className="grid grid-cols-5 gap-1">
          {[-2, -1, 0, 1, 2].map((score) => {
            const selected = current === score;
            return (
              <button
                key={score}
                type="submit"
                name="score"
                value={score}
                aria-pressed={selected}
                className={`rounded-md border px-1 py-2 text-xs ${
                  selected
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900"
                    : "border-zinc-300 dark:border-zinc-700"
                }`}
              >
                {SCORE_LABELS[score]}
              </button>
            );
          })}
        </div>
      </fieldset>
      <ErrorText state={state} />
    </form>
  );
}

export function CreateInviteForm({ tripId }: { tripId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createInviteAction, initialFormState);
  const [copied, setCopied] = useState(false);

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <form action={action}>
        <input type="hidden" name="tripId" value={tripId} />
        <button type="submit" disabled={pending} className={primaryButton}>
          Create invite link
        </button>
        <ErrorText state={state} />
      </form>
      {state.inviteLink ? (
        <div className="mt-3 rounded-md border border-zinc-300 p-3 dark:border-zinc-700">
          <label htmlFor="invite-link" className="block text-sm font-medium">
            New invite link
          </label>
          <input id="invite-link" readOnly value={state.inviteLink} className={`${inputClass} mt-1`} />
          <div className="mt-2 flex items-center gap-3">
            <button type="button" onClick={() => copy(state.inviteLink ?? "")} className={primaryButton}>
              Copy link
            </button>
            {copied ? <span role="status" className="text-sm">Copied.</span> : null}
          </div>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Copy it now. For safety only a hash is stored, so this link cannot be shown again.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function RevokeInviteButton({ tripId, inviteId }: { tripId: string; inviteId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(revokeInviteAction, initialFormState);
  return (
    <form action={action}>
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="inviteId" value={inviteId} />
      <button type="submit" disabled={pending} className={linkButton}>
        Revoke
      </button>
      <ErrorText state={state} />
    </form>
  );
}

export function RemoveMemberButton({
  tripId,
  userId,
  name,
}: {
  tripId: string;
  userId: string;
  name: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(removeMemberAction, initialFormState);
  return (
    <form action={action}>
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="userId" value={userId} />
      <button type="submit" disabled={pending} aria-label={`Remove ${name}`} className={linkButton}>
        Remove
      </button>
      <ErrorText state={state} />
    </form>
  );
}
