// Everything requires a signed-in Microsoft work account - once sign-in is
// configured.
//
// Running the check here rather than in each page means a new page is protected
// the moment it is added: the safe default, instead of one that depends on
// remembering to add a guard.

import { NextResponse, type NextRequest } from "next/server";
import type { NextFetchEvent, NextMiddleware } from "next/server";
import { auth } from "@/auth";
import { isAuthConfigured } from "@/lib/auth-config";

// Machine access for Excel and Power BI, which cannot hold a browser session.
// Off unless BOARD_API_KEY is set, so the default stays "signed in only".
function hasApiKey(request: Request): boolean {
  const expected = process.env.BOARD_API_KEY;
  if (!expected) return false;
  return request.headers.get("x-api-key") === expected;
}

// auth() types its result as a route handler, but it is equally usable as
// middleware and that is what Auth.js documents. The cast just tells TypeScript
// which of the two shapes we are calling it as.
const gate = auth((request) => {
  const { pathname } = request.nextUrl;

  if (request.auth) return NextResponse.next();
  if (pathname.startsWith("/api/") && hasApiKey(request)) return NextResponse.next();

  // A data feed should answer with an error, not a login page - a redirect here
  // means Excel silently receives HTML and reports something misleading.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Not signed in. Send a valid x-api-key header, or use a browser." },
      { status: 401 },
    );
  }

  const signInUrl = new URL("/signin", request.nextUrl.origin);
  // Come back to the page they actually asked for after signing in.
  signInUrl.searchParams.set("callbackUrl", pathname + request.nextUrl.search);
  return NextResponse.redirect(signInUrl);
}) as unknown as NextMiddleware;

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  // No Entra credentials yet - let everyone through rather than locking the
  // board behind a sign-in that cannot possibly succeed. Every page carries a
  // banner saying it is unprotected, so this cannot be mistaken for secured.
  if (!isAuthConfigured()) return NextResponse.next();

  return gate(request, event);
}

export const config = {
  // Everything except Next's own assets, the auth endpoints themselves and the
  // sign-in page - protecting those would be a redirect loop.
  matcher: ["/((?!api/auth|signin|_next/static|_next/image|favicon.ico).*)"],
};
