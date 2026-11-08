import { NextResponse, type NextRequest } from "next/server";
import {
  PENDING_INVITE_COOKIE,
  createRequestServices,
  getSessionState,
  postSignInTarget,
  redeemPendingInvite,
} from "@/server";

// Where every sign-in ends. Verifies the user, asks for a name if there is none,
// joins the trip from a pending invite (once), then goes to the requested page.
export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;
  const target = postSignInTarget(searchParams.get("next"));
  const to = (path: string) => NextResponse.redirect(new URL(path, origin));

  const { store } = await createRequestServices();
  const session = await getSessionState(store);
  if (session.state === "signed_out") return to(`/sign-in?next=${encodeURIComponent(target)}`);
  if (session.state === "needs_name") return to(`/welcome?next=${encodeURIComponent(target)}`);

  const pending = request.cookies.get(PENDING_INVITE_COOKIE)?.value;
  if (pending === undefined) return to(target);

  // The token is tried once: the cookie is cleared whatever the outcome.
  const result = await redeemPendingInvite(store, pending);
  const response =
    result.kind === "joined"
      ? to(`/trips/${result.tripId}`)
      : result.kind === "already_member"
        ? to(result.tripId ? `/trips/${result.tripId}` : "/trips")
        : to("/invite-invalid");
  response.cookies.set(PENDING_INVITE_COOKIE, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax" });
  return response;
}
