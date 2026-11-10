export { ServiceError, type ServiceErrorCode } from "./errors";
export { createTrip, getTrip, listMyTrips, removeMember, type TripView } from "./trips";
export { createInvite, listInvites, revokeInvite, joinWithInvite, previewInvite, hashInviteToken } from "./invites";
export {
  addFixedEvent,
  addManualQuote,
  removeFixedEvent,
  removeQuote,
  setDestinationConstraint,
  setMyAvailability,
  setTripConstraints,
  setTripDates,
} from "./constraints";
export { getPlanView, updateDestinationConstraint, updateTripConstraints, type PlanView } from "./plan";
export { listScenarios, loadEngineSnapshot, runScenario } from "./scenarios";
export { buildEngineInput, hashEngineInput, ENGINE_VERSION } from "./engine-input";
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
  inviteOutcomePath,
  isInviteTokenShape,
  pendingInviteCookie,
  redeemPendingInvite,
  resolveInviteConfirmation,
  type ConfirmationState,
  type RedeemResult,
} from "./pending-invite";
export { isPublicPath, joinTokenFromPath, signInRedirect } from "./proxy-rules";
export { createRequestServices } from "./supabase-store";
export type { Store, AuthGateway, InvitePreview, TripSummary } from "./store";
