/**
 * Whether sign-in is set up.
 *
 * Deliberately in its own file with no `next-auth` import, so the middleware
 * and the layout can ask the question without constructing Auth.js - which
 * throws if AUTH_SECRET is missing, the very state this is meant to detect.
 *
 * When this is false the board is READABLE BY ANYONE who can reach the URL,
 * and says so on every page. That is the demo state, not the deployed one.
 * Filling in the two Entra values switches enforcement on with no other change.
 */
export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.AUTH_SECRET &&
      process.env.AUTH_MICROSOFT_ENTRA_ID_ID &&
      process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
  );
}
