// The data layer the services depend on. Implemented over Supabase in supabase-store.ts
// and replaced by an in-memory fake in tests.

export type Role = "coordinator" | "member";

export interface TripRow {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  groupTargetMinor: number | null;
  baseCurrency: string;
}

export interface MemberRow {
  userId: string;
  role: Role;
  displayName: string;
  homeAirport: string | null;
}

export interface DestinationRow {
  id: string;
  name: string;
  suggestedBy: string;
}

export interface PreferenceRow {
  destinationId: string;
  userId: string;
  score: number;
}

export interface BudgetRow {
  tripId: string;
  ceilingMinor: number;
}

export interface InviteRow {
  id: string;
  tripId: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface TripSummary {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  role: Role;
}

/** The only facts a signed-out visitor sees about an invite. */
export interface InvitePreview {
  tripName: string;
  inviterName: string;
  memberCount: number;
}

export interface Store {
  /** The caller's display name. Null when there is no profile row. Empty until onboarding. */
  getDisplayName(userId: string): Promise<string | null>;
  setDisplayName(userId: string, displayName: string): Promise<void>;
  /** Trips the given user belongs to. Row-level security also limits the rows. */
  listMyTrips(userId: string): Promise<TripSummary[]>;
  /** Works signed out. Null for unknown, expired, revoked and malformed tokens alike. */
  getInvitePreview(token: string): Promise<InvitePreview | null>;
  /** The trip id behind a live invite when the caller already belongs to it, else null. */
  getTripIfMember(token: string): Promise<string | null>;

  /** The authenticated user, verified with the auth server. Null when signed out. */
  currentUserId(): Promise<string | null>;

  createTrip(input: {
    name: string;
    startDate?: string;
    endDate?: string;
    groupTargetMinor?: number;
    baseCurrency: string;
  }): Promise<string>;
  /** Coordinator-only in the database. Deletes the membership, preferences and budget. */
  removeMember(tripId: string, userId: string): Promise<void>;
  getRole(tripId: string, userId: string): Promise<Role | null>;
  getTrip(tripId: string): Promise<TripRow | null>;
  listMembers(tripId: string): Promise<MemberRow[]>;
  listDestinations(tripId: string): Promise<DestinationRow[]>;
  listPreferences(tripId: string): Promise<PreferenceRow[]>;
  /** Only ever called with the caller's own id. */
  getBudget(tripId: string, userId: string): Promise<BudgetRow | null>;

  insertInvite(input: {
    tripId: string;
    tokenHash: string;
    createdBy: string;
    expiresAt: string;
  }): Promise<InviteRow>;
  getInvite(inviteId: string): Promise<InviteRow | null>;
  /** Invitations for a trip, newest first. Row-level security returns rows only to the coordinator. Never includes token hashes. */
  listInvites(tripId: string): Promise<InviteRow[]>;
  revokeInvite(inviteId: string): Promise<void>;
  /** Hashing and all checks happen in the database. Throws ServiceError. */
  joinWithInvite(token: string): Promise<string>;

  insertDestination(input: { tripId: string; name: string; suggestedBy: string }): Promise<DestinationRow>;
  upsertPreference(input: {
    tripId: string;
    destinationId: string;
    userId: string;
    score: number;
  }): Promise<PreferenceRow>;
  upsertBudget(input: { tripId: string; userId: string; ceilingMinor: number }): Promise<BudgetRow>;
}

export interface AuthGateway {
  sendMagicLink(email: string, redirectTo: string): Promise<void>;
  exchangeCode(code: string): Promise<boolean>;
  /** Starts the Google flow and returns the provider URL to send the browser to. */
  googleSignInUrl(redirectTo: string): Promise<string>;
  /** True when the code was valid and a session cookie was set. */
  verifyEmailCode(email: string, code: string): Promise<boolean>;
  /** Ends the session on this device only. */
  signOut(): Promise<void>;
}
