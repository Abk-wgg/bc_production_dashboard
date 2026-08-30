// Sign-in with a Microsoft work account (Entra ID).
//
// This is about WHO MAY LOOK AT THE BOARD. It is a completely separate thing
// from how the app reads Business Central - that still happens server-side as
// one service identity (see src/lib/bc/client.ts), and a viewer's own BC
// permissions are neither used nor needed. A viewer does not need a BC licence.
//
// Uses its own Entra app registration, not the BC one. The BC registration is a
// service with no redirect URI and application permissions; this one is a
// sign-in app with a redirect URI and delegated permissions. See AUTH-SETUP.md.

import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

/**
 * Single-tenant issuer. This is the security boundary: pointing at our tenant
 * rather than "common" means only NextGEN360 / Wilson George accounts can sign
 * in. With "common" any Microsoft account in the world would be accepted.
 */
const issuer = `https://login.microsoftonline.com/${
  process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID ?? process.env.BC_TENANT_ID
}/v2.0`;

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Self-hosted on an internal box, not Vercel, so Auth.js has no way to work
  // out its own public URL. Without this it refuses to run behind whatever
  // hostname the internal server answers on.
  trustHost: true,

  providers: [MicrosoftEntraID({ issuer })],

  callbacks: {
    jwt({ token }) {
      // The Entra provider fetches the user's profile photo from Graph and
      // inlines it as a base64 data URI. With a JWT session that goes into the
      // session cookie, which browsers cap at about 4KB - a photo can push it
      // over and break sign-in in a way that is very hard to diagnose. The
      // board shows no avatar, so drop it.
      delete token.picture;
      return token;
    },
  },

  pages: {
    // Our own page, so a signed-out viewer sees the board's name and one
    // button rather than a generic Auth.js screen listing providers.
    signIn: "/signin",
  },
});
