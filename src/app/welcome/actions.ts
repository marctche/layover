"use server";

import { redirect } from "next/navigation";
import { createRequestServices, ServiceError, setDisplayName } from "@/server";

export interface WelcomeState {
  error?: string;
}

export async function saveNameAction(_prev: WelcomeState, formData: FormData): Promise<WelcomeState> {
  const name = formData.get("displayName");
  const next = formData.get("next");
  try {
    const { store } = await createRequestServices();
    await setDisplayName(store, { displayName: typeof name === "string" ? name : "" });
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error;
    if (error.code === "unauthenticated") redirect("/sign-in");
    if (error.code === "invalid_input") return { error: "Enter a name between 1 and 80 characters." };
    return { error: "We could not save your name. Try again." };
  }
  redirect(`/auth/continue?next=${encodeURIComponent(typeof next === "string" ? next : "")}`);
}
