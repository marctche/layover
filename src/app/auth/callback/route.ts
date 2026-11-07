import { NextResponse } from "next/server";
import { completeSignIn, createRequestServices, ServiceError } from "@/server";

// Magic-link landing point: exchanges the one-time code for a session cookie.
export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const { auth } = await createRequestServices();
    const path = await completeSignIn(auth, url.searchParams.get("code"), url.searchParams.get("next"));
    return NextResponse.redirect(new URL(path, url.origin));
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error;
    return NextResponse.redirect(new URL("/?auth_error=1", url.origin));
  }
}
