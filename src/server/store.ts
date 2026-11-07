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

export interface Store {
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
}
