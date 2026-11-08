import { googleSignInAction } from "@/app/sign-in/actions";
import { EmailSignIn } from "./email-sign-in";

/** Google as the main option, email code as the quiet alternative. */
export function SignInOptions({ next, error }: { next: string; error?: string }) {
  return (
    <div className="space-y-5">
      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      <form action={googleSignInAction}>
        <input type="hidden" name="next" value={next} />
        <button
          type="submit"
          className="w-full rounded-md bg-zinc-900 px-4 py-3 font-medium text-white dark:bg-white dark:text-zinc-900"
        >
          Continue with Google
        </button>
      </form>
      <div className="text-center">
        <EmailSignIn next={next} />
      </div>
    </div>
  );
}
