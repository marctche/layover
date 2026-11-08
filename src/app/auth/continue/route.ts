import { NextResponse, type NextRequest } from "next/server";
import {
  PENDING_INVITE_COOKIE,
  createRequestServices,
  getSessionState,
  inviteOutcomePath,
  postSignInTarget,
  resolveInviteConfirmation,
} from "@/server";

// Where every sign-in ends. Verifies the user, asks for a name if there is none, and sends
// anyone holding a pending invite to the confirmation page. This route never joins a trip:
// a GET must not change state, so joining is a separate, explicit POST.
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

  const state = await resolveInviteConfirmation(store, pending);
  if (state.kind === "confirm") return to("/join/confirm");
  if (state.kind === "none") return to(target);

  // Already a member, or the link no longer works: nothing to confirm, so drop the cookie.
  const response = to(inviteOutcomePath(state.kind === "already_member" ? { kind: "already_member", tripId: state.tripId } : { kind: "invalid" }));
  response.cookies.set(PENDING_INVITE_COOKIE, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax" });
  return response;
}
