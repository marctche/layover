import { NextResponse, type NextRequest } from "next/server";
import { refreshSession } from "@/db/proxy";
import { pendingInviteCookie } from "@/server/pending-invite";
import { isPublicPath, joinTokenFromPath, signInRedirect } from "@/server/proxy-rules";

// Refreshes the session cookies on every matched request and sends signed-out visitors away
// from protected pages. This is an optimistic check only: every page and action still
// verifies the user on the server, and row-level security backs all data access.
export async function proxy(request: NextRequest) {
  const { response, signedIn } = await refreshSession(request);
  const { pathname, search } = request.nextUrl;

  // An invite link remembers its token while the visitor signs in.
  const inviteToken = joinTokenFromPath(pathname);
  if (inviteToken) {
    const cookie = pendingInviteCookie(inviteToken, process.env.NODE_ENV === "production");
    if (cookie) response.cookies.set(cookie.name, cookie.value, cookie.options);
  }

  if (!signedIn && !isPublicPath(pathname)) {
    const redirect = NextResponse.redirect(new URL(signInRedirect(pathname, search), request.url));
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}

export const config = {
  // Everything except static files and image optimization.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
