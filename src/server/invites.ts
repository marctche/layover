import { createHash, randomBytes } from "node:crypto";
import { requireCoordinator, requireUser } from "./access";
import { ServiceError } from "./errors";
import { createInviteInput, joinWithInviteInput, parseInput, revokeInviteInput } from "./schemas";
import type { InvitePreview, Store } from "./store";

/** What a signed-out visitor may see about an invite. Null when the link is not usable, for any reason. */
export async function previewInvite(store: Store, raw: unknown): Promise<InvitePreview | null> {
  const parsed = joinWithInviteInput.safeParse(raw);
  if (!parsed.success) return null;
  return store.getInvitePreview(parsed.data.token);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** SHA-256 of the UTF-8 token, hex. The join function in the database computes the same value. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function createInvite(
  store: Store,
  raw: unknown,
  now: () => Date = () => new Date(),
): Promise<{ inviteId: string; token: string; expiresAt: string }> {
  const { tripId, expiresInDays } = parseInput(createInviteInput, raw);
  const userId = await requireUser(store);
  await requireCoordinator(store, tripId, userId);

  // 32 random bytes. The plaintext leaves this function once, in the return value;
  // only its hash reaches the database.
  const token = randomBytes(32).toString("base64url");
  const row = await store.insertInvite({
    tripId,
    tokenHash: hashInviteToken(token),
    createdBy: userId,
    expiresAt: new Date(now().getTime() + expiresInDays * DAY_MS).toISOString(),
  });
  return { inviteId: row.id, token, expiresAt: row.expiresAt };
}

export async function revokeInvite(store: Store, raw: unknown): Promise<void> {
  const { inviteId } = parseInput(revokeInviteInput, raw);
  const userId = await requireUser(store);
  const invite = await store.getInvite(inviteId);
  // Row-level security hides invitations from non-coordinators, so this is also not_found for them.
  if (!invite) throw new ServiceError("not_found");
  await requireCoordinator(store, invite.tripId, userId);
  await store.revokeInvite(inviteId);
}

export async function joinWithInvite(store: Store, raw: unknown): Promise<{ tripId: string }> {
  const { token } = parseInput(joinWithInviteInput, raw);
  await requireUser(store);
  const tripId = await store.joinWithInvite(token);
  return { tripId };
}
