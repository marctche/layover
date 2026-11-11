import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createServerDb } from "@/db/server";
import { isBudgetBand } from "@/domain/budget/bands";
import { ServiceError } from "./errors";
import type {
  AuthGateway,
  BudgetRow,
  DestinationRow,
  InviteRow,
  AvailabilityRow,
  DestinationConstraintRow,
  FixedEventRow,
  MemberRow,
  PlanningStore,
  PreferenceRow,
  QuoteRow,
  Role,
  ScenarioRow,
  Store,
  TripConstraintsRow,
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
    case "22023": // invalid parameter (set_my_availability)
    case "22007": // bad date text
    case "22008":
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
  lat: (r.lat as number | null) ?? null,
  lng: (r.lng as number | null) ?? null,
});

const toPreference = (r: Row): PreferenceRow => ({
  destinationId: r.destination_id as string,
  userId: r.user_id as string,
  score: r.score as number,
});

const toBudget = (r: Row): BudgetRow => ({
  tripId: r.trip_id as string,
  band: isBudgetBand(r.band) ? r.band : null,
  ceilingMinor: (r.ceiling_minor as number | null) ?? null,
  currency: r.currency as string,
  flexibilityMinor: (r.flexibility_minor as number | null) ?? null,
});

const BUDGET_COLUMNS = "trip_id, band, ceiling_minor, currency, flexibility_minor";

const toTripConstraints = (r: Row): TripConstraintsRow => ({
  departureAirport: (r.departure_airport as string | null) ?? null,
  startDestinationId: (r.start_destination_id as string | null) ?? null,
  endDestinationId: (r.end_destination_id as string | null) ?? null,
  earliestStart: (r.earliest_start as string | null) ?? null,
  latestEnd: (r.latest_end as string | null) ?? null,
  minNights: (r.min_nights as number | null) ?? null,
  maxNights: (r.max_nights as number | null) ?? null,
});
const TRIP_CONSTRAINT_COLUMNS =
  "departure_airport, start_destination_id, end_destination_id, earliest_start, latest_end, min_nights, max_nights";

const toDestinationConstraint = (r: Row): DestinationConstraintRow => ({
  destinationId: r.destination_id as string,
  minNights: r.min_nights as number,
  maxNights: (r.max_nights as number | null) ?? null,
  mustInclude: r.must_include as boolean,
  lockPosition: (r.lock_position as number | null) ?? null,
});
const DESTINATION_CONSTRAINT_COLUMNS = "destination_id, min_nights, max_nights, must_include, lock_position";

const toFixedEvent = (r: Row): FixedEventRow => ({
  id: r.id as string,
  destinationId: r.destination_id as string,
  label: r.label as string,
  startDate: r.start_date as string,
  endDate: r.end_date as string,
});
const FIXED_EVENT_COLUMNS = "id, destination_id, label, start_date, end_date";

const toQuote = (r: Row): QuoteRow => ({
  id: r.id as string,
  kind: r.kind as QuoteRow["kind"],
  mode: r.mode as QuoteRow["mode"],
  fromDestinationId: (r.from_destination_id as string | null) ?? null,
  toDestinationId: (r.to_destination_id as string | null) ?? null,
  returnFromDestinationId: (r.return_from_destination_id as string | null) ?? null,
  originAirport: (r.origin_airport as string | null) ?? null,
  destinationAirport: (r.destination_airport as string | null) ?? null,
  durationMinutes: r.duration_minutes as number,
  returnMinutes: (r.return_minutes as number | null) ?? null,
  amountMinor: r.amount_minor as number,
  currency: r.currency as string,
  adults: r.adults as number,
  source: r.source as QuoteRow["source"],
  provider: (r.provider as string | null) ?? null,
  fetchedAt: r.fetched_at as string,
  expiresAt: (r.expires_at as string | null) ?? null,
  createdBy: (r.created_by as string | null) ?? null,
});
const QUOTE_COLUMNS =
  "id, kind, mode, from_destination_id, to_destination_id, return_from_destination_id, origin_airport, destination_airport, duration_minutes, return_minutes, amount_minor, currency, adults, source, provider, fetched_at, expires_at, created_by";

const toScenario = (r: Row): ScenarioRow => ({
  id: r.id as string,
  engineVersion: r.engine_version as string,
  inputHash: r.input_hash as string,
  ok: r.ok as boolean,
  createdBy: (r.created_by as string | null) ?? null,
  createdAt: r.created_at as string,
  result: r.result,
});
const SCENARIO_COLUMNS = "id, engine_version, input_hash, ok, created_by, created_at, result";

export function createSupabaseStore(db: SupabaseClient): Store & PlanningStore {
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
        startDate: (row.start_date as string | null) ?? null,
        endDate: (row.end_date as string | null) ?? null,
        departureAirport: (row.departure_airport as string | null) ?? null,
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
        await db.from("destinations").select("id, name, suggested_by, lat, lng").eq("trip_id", tripId).order("created_at"),
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
          .select(BUDGET_COLUMNS)
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

    async listInvites(tripId) {
      return mustList(
        await db
          .from("invitations")
          .select("id, trip_id, expires_at, revoked_at")
          .eq("trip_id", tripId)
          .order("created_at", { ascending: false }),
      ).map(toInvite);
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
          .insert({
            trip_id: input.tripId,
            name: input.name,
            suggested_by: input.suggestedBy,
            ...(input.lat !== undefined && input.lng !== undefined ? { lat: input.lat, lng: input.lng } : {}),
          })
          .select("id, name, suggested_by, lat, lng")
          .single(),
      );
      return toDestination(row);
    },

    async deleteDestination(tripId, destinationId) {
      const { data, error } = await db.from("destinations").delete().eq("trip_id", tripId).eq("id", destinationId).select("id");
      if (error) fail(error);
      // No row removed: unknown id, another trip, or not the coordinator.
      return (data?.length ?? 0) > 0;
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
              band: input.band,
              ceiling_minor: input.ceilingMinor,
              currency: input.currency,
              flexibility_minor: input.flexibilityMinor,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "trip_id,user_id" },
          )
          .select(BUDGET_COLUMNS)
          .single(),
      );
      return toBudget(row);
    },

    async setTripDates(tripId, startDate, endDate) {
      const { data, error } = await db
        .from("trips")
        .update({ start_date: startDate, end_date: endDate })
        .eq("id", tripId)
        .select("id");
      if (error) fail(error);
      // No row updated: not the coordinator, or the trip is no longer in planning.
      if (!data || data.length !== 1) throw new ServiceError("forbidden");
    },

    async getTripConstraints(tripId) {
      const row = optional(
        await db.from("trip_constraints").select(TRIP_CONSTRAINT_COLUMNS).eq("trip_id", tripId).maybeSingle(),
      );
      return row ? toTripConstraints(row) : null;
    },

    async upsertTripConstraints(tripId, c) {
      const row = must(
        await db
          .from("trip_constraints")
          .upsert(
            {
              trip_id: tripId,
              departure_airport: c.departureAirport,
              start_destination_id: c.startDestinationId,
              end_destination_id: c.endDestinationId,
              earliest_start: c.earliestStart,
              latest_end: c.latestEnd,
              min_nights: c.minNights,
              max_nights: c.maxNights,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "trip_id" },
          )
          .select(TRIP_CONSTRAINT_COLUMNS)
          .single(),
      );
      return toTripConstraints(row);
    },

    async listDestinationConstraints(tripId) {
      return mustList(
        await db.from("destination_constraints").select(DESTINATION_CONSTRAINT_COLUMNS).eq("trip_id", tripId),
      ).map(toDestinationConstraint);
    },

    async upsertDestinationConstraint(tripId, c) {
      const row = must(
        await db
          .from("destination_constraints")
          .upsert(
            {
              trip_id: tripId,
              destination_id: c.destinationId,
              min_nights: c.minNights,
              max_nights: c.maxNights,
              must_include: c.mustInclude,
              lock_position: c.lockPosition,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "destination_id" },
          )
          .select(DESTINATION_CONSTRAINT_COLUMNS)
          .single(),
      );
      return toDestinationConstraint(row);
    },

    async listFixedEvents(tripId) {
      return mustList(
        await db.from("trip_fixed_events").select(FIXED_EVENT_COLUMNS).eq("trip_id", tripId).order("start_date"),
      ).map(toFixedEvent);
    },

    async insertFixedEvent(tripId, e) {
      const row = must(
        await db
          .from("trip_fixed_events")
          .insert({
            trip_id: tripId,
            destination_id: e.destinationId,
            label: e.label,
            start_date: e.startDate,
            end_date: e.endDate,
          })
          .select(FIXED_EVENT_COLUMNS)
          .single(),
      );
      return toFixedEvent(row);
    },

    async deleteFixedEvent(tripId, eventId) {
      const { data, error } = await db
        .from("trip_fixed_events")
        .delete()
        .eq("trip_id", tripId)
        .eq("id", eventId)
        .select("id");
      if (error) fail(error);
      return (data ?? []).length > 0;
    },

    async listAvailability(tripId) {
      const people = mustList(
        await db.from("member_availability").select("user_id, flexibility_days").eq("trip_id", tripId),
      );
      const ranges = mustList(
        await db
          .from("member_availability_ranges")
          .select("user_id, start_date, end_date")
          .eq("trip_id", tripId)
          .order("start_date"),
      );
      return people.map(
        (p): AvailabilityRow => ({
          userId: p.user_id as string,
          flexibilityDays: p.flexibility_days as number,
          ranges: ranges
            .filter((r) => r.user_id === p.user_id)
            .map((r) => ({ startDate: r.start_date as string, endDate: r.end_date as string })),
        }),
      );
    },

    async setMyAvailability(tripId, flexibilityDays, ranges) {
      const { error } = await db.rpc("set_my_availability", {
        p_trip_id: tripId,
        p_flexibility_days: flexibilityDays,
        p_ranges: ranges.map((r) => ({ start_date: r.startDate, end_date: r.endDate })),
      });
      if (error) fail(error);
    },

    async listQuotes(tripId) {
      return mustList(await db.from("quotes").select(QUOTE_COLUMNS).eq("trip_id", tripId)).map(toQuote);
    },

    async insertManualQuote(q) {
      const row = must(
        await db
          .from("quotes")
          .insert({
            trip_id: q.tripId,
            kind: q.kind,
            mode: q.mode,
            from_destination_id: q.fromDestinationId,
            to_destination_id: q.toDestinationId,
            return_from_destination_id: q.returnFromDestinationId,
            origin_airport: q.originAirport,
            destination_airport: q.destinationAirport,
            duration_minutes: q.durationMinutes,
            return_minutes: q.returnMinutes,
            amount_minor: q.amountMinor,
            currency: q.currency,
            expires_at: q.expiresAt,
            // The database accepts only manual here, whatever the caller sends.
            source: "manual",
            created_by: q.createdBy,
          })
          .select(QUOTE_COLUMNS)
          .single(),
      );
      return toQuote(row);
    },

    async deleteQuote(tripId, quoteId) {
      const { data, error } = await db.from("quotes").delete().eq("trip_id", tripId).eq("id", quoteId).select("id");
      if (error) fail(error);
      return (data ?? []).length > 0;
    },

    async listScenarios(tripId) {
      return mustList(
        await db
          .from("route_scenarios")
          .select(SCENARIO_COLUMNS)
          .eq("trip_id", tripId)
          .order("created_at", { ascending: false }),
      ).map(toScenario);
    },

    async findScenario(tripId, engineVersion, inputHash) {
      const row = optional(
        await db
          .from("route_scenarios")
          .select(SCENARIO_COLUMNS)
          .eq("trip_id", tripId)
          .eq("engine_version", engineVersion)
          .eq("input_hash", inputHash)
          .maybeSingle(),
      );
      return row ? toScenario(row) : null;
    },

    async insertScenario(s) {
      const row = must(
        await db
          .from("route_scenarios")
          .insert({
            trip_id: s.tripId,
            engine_version: s.engineVersion,
            input_hash: s.inputHash,
            input: s.input,
            result: s.result,
            ok: s.ok,
            created_by: s.createdBy,
          })
          .select(SCENARIO_COLUMNS)
          .single(),
      );
      return toScenario(row);
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
export async function createRequestServices(): Promise<{ store: Store & PlanningStore; auth: AuthGateway }> {
  const db = await createServerDb();
  return { store: createSupabaseStore(db), auth: createAuthGateway(db) };
}
