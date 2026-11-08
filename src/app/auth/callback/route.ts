import { NextResponse } from "next/server";
import { completeSignIn, createRequestServices, ServiceError } from "@/server";

// Landing point for the emailed link and for Google: exchanges the one-time code for a
// session cookie, then hands over to /auth/continue.
export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const { auth } = await createRequestServices();
    const path = await completeSignIn(auth, url.searchParams.get("code"), url.searchParams.get("next"));
    return NextResponse.redirect(new URL(`/auth/continue?next=${encodeURIComponent(path)}`, url.origin));
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error;
    return NextResponse.redirect(new URL("/sign-in?error=link", url.origin));
  }
}
