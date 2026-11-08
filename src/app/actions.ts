"use server";

import { redirect } from "next/navigation";
import { createRequestServices, signOut } from "@/server";

/** Ends the session on this device only. */
export async function signOutAction(): Promise<void> {
  const { auth } = await createRequestServices();
  await signOut(auth);
  redirect("/");
}
