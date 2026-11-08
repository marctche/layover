export { ServiceError, type ServiceErrorCode } from "./errors";
export { createTrip, getTrip, listMyTrips, removeMember, type TripView } from "./trips";
export { createInvite, revokeInvite, joinWithInvite, previewInvite, hashInviteToken } from "./invites";
export { suggestDestination, setPreference, setOwnBudget } from "./planning";
export {
  completeSignIn,
  gateRedirect,
  getSessionState,
  postSignInTarget,
  safeNextPath,
  setDisplayName,
  signInWithMagicLink,
  signOut,
  startGoogleSignIn,
  verifyEmailCode,
  type SessionState,
} from "./auth";
export {
  PENDING_INVITE_COOKIE,
  isInviteTokenShape,
  pendingInviteCookie,
  redeemPendingInvite,
  type RedeemResult,
} from "./pending-invite";
export { isPublicPath, joinTokenFromPath, signInRedirect } from "./proxy-rules";
export { createRequestServices } from "./supabase-store";
export type { Store, AuthGateway, InvitePreview, TripSummary } from "./store";
