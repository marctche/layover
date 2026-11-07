import { ServiceError } from "./errors";
import type { Role, Store } from "./store";

export async function requireUser(store: Store): Promise<string> {
  const userId = await store.currentUserId();
  if (!userId) throw new ServiceError("unauthenticated");
  return userId;
}

/** Non-members get not_found, so a trip id reveals nothing about whether the trip exists. */
export async function requireMember(store: Store, tripId: string, userId: string): Promise<Role> {
  const role = await store.getRole(tripId, userId);
  if (!role) throw new ServiceError("not_found");
  return role;
}

export async function requireCoordinator(store: Store, tripId: string, userId: string): Promise<void> {
  const role = await requireMember(store, tripId, userId);
  if (role !== "coordinator") throw new ServiceError("forbidden");
}
