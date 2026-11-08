import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createServerDb } from "@/db/server";
import { ServiceError } from "./errors";
import type {
  AuthGateway,
  BudgetRow,
  DestinationRow,
  InviteRow,
  MemberRow,
  PreferenceRow,
  Role,
  Store,
  TripRow,
  TripSummary,
} from "./store";

// Database errors are translated to ServiceError codes. Raw messages are not passed on,
// because they can name tables, constraints and policies.
function fail(error: PostgrestError): never {
  if (error.message === "invite_invalid") throw new ServiceError("invite_invalid");
  if (error.message === "already_member") throw new ServiceError("already_member");
  if (error.message === "cannot_remove_self") throw new ServiceError("invalid_input");
  if (error.message === "member_not_found") throw new ServiceError("not_found");
  switch (error.code) {
    case "28000":
      throw new ServiceError("unauthenticated");
    case "42501":
      throw new ServiceError("forbidden");
    case "23505":
      throw new ServiceError("conflict");
    case "23503":
      throw new ServiceError("not_found");
    case "23514":
      throw new ServiceError("invalid_input");
    default:
      throw new ServiceError("internal");
  }
}

type Row = Record<string, unknown>;
type Result = { data: unknown; error: PostgrestError | null };

// The client is untyped (no generated types), so rows are checked here as plain records.
function must(result: Result): Row {
  if (result.error) fail(result.error);
  if (result.data === null || result.data === undefined) throw new ServiceError("internal");
  return result.data as Row;
}

function mustList(result: Result): Row[] {
  if (result.error) fail(result.error);
  return (result.data ?? []) as Row[];
}

function optional(result: Result): Row | null {
  if (result.error) fail(result.error);
  return (result.data as Row | null) ?? null;
}

const toTrip = (r: Row): TripRow => ({
  id: r.id as string,
  name: r.name as string,
  startDate: (r.start_date as string | null) ?? null,
  endDate: (r.end_date as string | null) ?? null,
  status: r.status as string,
  groupTargetMinor: (r.group_target_minor as number | null) ?? null,
  baseCurrency: r.base_currency as string,
});

const toInvite = (r: Row): InviteRow => ({
  id: r.id as string,
  tripId: r.trip_id as string,
  expiresAt: r.expires_at as string,
  revokedAt: (r.revoked_at as string | null) ?? null,
});

const toDestination = (r: Row): DestinationRow => ({
  id: r.id as string,
  name: r.name as string,
  suggestedBy: r.suggested_by as string,
});

const toPreference = (r: Row): PreferenceRow => ({
  destinationId: r.destination_id as string,
  userId: r.user_id as string,
  score: r.score as number,
});

const toBudget = (r: Row): BudgetRow => ({
  tripId: r.trip_id as string,
  ceilingMinor: r.ceiling_minor as number,
});

export function createSupabaseStore(db: SupabaseClient): Store {
  return {
    async currentUserId() {
      // getUser asks the auth server to validate the token, unlike reading the cookie.
      const { data, error } = await db.auth.getUser();
      if (error || !data.user) return null;
      return data.user.id;
    },

    async getDisplayName(userId) {
      const row = optional(await db.from("profiles").select("display_name").eq("id", userId).maybeSingle());
      return row ? (row.display_name as string) : null;
    },

    async setDisplayName(userId, displayName) {
      const { data, error } = await db
        .from("profiles")
        .update({ display_name: displayName })
        .eq("id", userId)
        .select("id");
      if (error) fail(error);
      if (!data || data.length !== 1) throw new ServiceError("not_found");
    },

    async listMyTrips(userId) {
      const rows = mustList(
        await db
          .from("trip_members")
          .select("role, joined_at, trips(id, name, start_date, end_date)")
          .eq("user_id", userId)
          .order("joined_at", { ascending: false }),
      );
      return rows.flatMap((r): TripSummary[] => {
        const trip = r.trips as unknown as { id: string; name: string; start_date: string | null; end_date: string | null } | null;
        if (!trip) return [];
        return [{ id: trip.id, name: trip.name, startDate: trip.start_date, endDate: trip.end_date, role: r.role as Role }];
      });
    },

    async getTripIfMember(token) {
      const { data, error } = await db.rpc("invite_trip_if_member", { p_token: token });
      if (error) fail(error);
      const id = z.uuid().safeParse(data);
      return id.success ? id.data : null;
    },

    async getInvitePreview(token) {
      const rows = mustList(await db.rpc("invite_preview", { p_token: token }));
      const row = rows[0];
      if (!row) return null;
      return {
        tripName: row.trip_name as string,
        inviterName: row.inviter_name as string,
        memberCount: row.member_count as number,
      };
    },

    async createTrip(input) {
      const { data, error } = await db.rpc("create_trip", {
        p_name: input.name,
        p_start_date: input.startDate ?? null,
        p_end_date: input.endDate ?? null,
        p_group_target_minor: input.groupTargetMinor ?? null,
        p_base_currency: input.baseCurrency,
      });
      if (error) fail(error);
      return data as string;
    },

    async removeMember(tripId, userId) {
      const { error } = await db.rpc("remove_member", { p_trip_id: tripId, p_user_id: userId });
      if (error) fail(error);
    },

    async getRole(tripId, userId) {
      const row = optional(
        await db.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", userId).maybeSingle(),
      );
      return row ? (row.role as Role) : null;
    },

    async getTrip(tripId) {
      const row = optional(
        await db
          .from("trips")
          .select("id, name, start_date, end_date, status, group_target_minor, base_currency")
          .eq("id", tripId)
          .maybeSingle(),
      );
      return row ? toTrip(row) : null;
    },

    async listMembers(tripId) {
      const rows = mustList(
        await db
          .from("trip_members")
          .select("user_id, role, home_airport, profiles(display_name)")
          .eq("trip_id", tripId)
          .order("joined_at"),
      );
      return rows.map((r): MemberRow => {
        const profile = r.profiles as unknown as { display_name: string } | null;
        return {
          userId: r.user_id as string,
          role: r.role as Role,
          displayName: profile?.display_name ?? "",
          homeAirport: (r.home_airport as string | null) ?? null,
        };
      });
    },

    async listDestinations(tripId) {
      const rows = mustList(
        await db.from("destinations").select("id, name, suggested_by").eq("trip_id", tripId).order("created_at"),
      );
      return rows.map(toDestination);
    },

    async listPreferences(tripId) {
      const rows = mustList(
        await db.from("destination_preferences").select("destination_id, user_id, score").eq("trip_id", tripId),
      );
      return rows.map(toPreference);
    },

    async getBudget(tripId, userId) {
      const row = optional(
        await db
          .from("member_budgets")
          .select("trip_id, ceiling_minor")
          .eq("trip_id", tripId)
          .eq("user_id", userId)
          .maybeSingle(),
      );
      return row ? toBudget(row) : null;
    },

    async insertInvite(input) {
      const row = must(
        await db
          .from("invitations")
          .insert({
            trip_id: input.tripId,
            token_hash: input.tokenHash,
            created_by: input.createdBy,
            expires_at: input.expiresAt,
          })
          .select("id, trip_id, expires_at, revoked_at")
          .single(),
      );
      return toInvite(row);
    },

    async getInvite(inviteId) {
      const row = optional(
        await db.from("invitations").select("id, trip_id, expires_at, revoked_at").eq("id", inviteId).maybeSingle(),
      );
      return row ? toInvite(row) : null;
    },

    async revokeInvite(inviteId) {
      // Zero rows updated means it was already revoked, which is the desired end state.
      const { error } = await db
        .from("invitations")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", inviteId)
        .select("id");
      if (error) fail(error);
    },

    async joinWithInvite(token) {
      const { data, error } = await db.rpc("join_with_invite", { p_token: token });
      if (error?.message === "already_member") {
        // The function puts the trip id in the error detail.
        const tripId = z.uuid().safeParse(error.details);
        throw new ServiceError("already_member", undefined, tripId.success ? tripId.data : undefined);
      }
      if (error) fail(error);
      return data as string;
    },

    async insertDestination(input) {
      const row = must(
        await db
          .from("destinations")
          .insert({ trip_id: input.tripId, name: input.name, suggested_by: input.suggestedBy })
          .select("id, name, suggested_by")
          .single(),
      );
      return toDestination(row);
    },

    async upsertPreference(input) {
      const row = must(
        await db
          .from("destination_preferences")
          .upsert(
            {
              trip_id: input.tripId,
              destination_id: input.destinationId,
              user_id: input.userId,
              score: input.score,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "destination_id,user_id" },
          )
          .select("destination_id, user_id, score")
          .single(),
      );
      return toPreference(row);
    },

    async upsertBudget(input) {
      const row = must(
        await db
          .from("member_budgets")
          .upsert(
            {
              trip_id: input.tripId,
              user_id: input.userId,
              ceiling_minor: input.ceilingMinor,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "trip_id,user_id" },
          )
          .select("trip_id, ceiling_minor")
          .single(),
      );
      return toBudget(row);
    },
  };
}

export function createAuthGateway(db: SupabaseClient): AuthGateway {
  return {
    async sendMagicLink(email, redirectTo) {
      const { error } = await db.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
      if (error) throw new ServiceError("internal");
    },
    async exchangeCode(code) {
      const { error } = await db.auth.exchangeCodeForSession(code);
      return !error;
    },
    async googleSignInUrl(redirectTo) {
      const { data, error } = await db.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error || !data.url) throw new ServiceError("internal");
      return data.url;
    },
    async verifyEmailCode(email, code) {
      const { data, error } = await db.auth.verifyOtp({ email, token: code, type: "email" });
      return !error && data.session !== null;
    },
    async signOut() {
      const { error } = await db.auth.signOut({ scope: "local" });
      if (error) throw new ServiceError("internal");
    },
  };
}

/** Store and auth gateway bound to the current request's session cookie. */
export async function createRequestServices(): Promise<{ store: Store; auth: AuthGateway }> {
  const db = await createServerDb();
  return { store: createSupabaseStore(db), auth: createAuthGateway(db) };
}
