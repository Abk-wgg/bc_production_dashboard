import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import Nav from "@/components/nav";
import UserMenu from "@/components/user-menu";
import UnprotectedBanner from "@/components/unprotected-banner";
import { isAuthConfigured } from "@/lib/auth-config";
import { auth } from "@/auth";
import "./globals.css";

// Self-hosted at build time rather than fetched from Google at runtime - the
// server this runs on is an internal box that may have no route to the
// internet, and a webfont that hangs takes the whole first paint with it.
const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  // The page's own name comes first, because a tab strip with four of these
  // open truncates from the right - "Production board" on all four is four
  // identical tabs. `default` covers /signin and anything with no title of
  // its own.
  title: { default: "Production board", template: "%s · Production board" },
  description: "Read-only view of Business Central production orders",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Only ask Auth.js anything once it is actually set up - calling it without
  // AUTH_SECRET throws, and "not configured" is a state we support on purpose.
  const authConfigured = isAuthConfigured();
  const session = authConfigured ? await auth() : null;

  // Signed out, the only page reachable is /signin, where a nav bar full of
  // links that just bounce back here would be noise. With no sign-in at all,
  // every page is reachable, so the header always belongs.
  const showHeader = !authConfigured || Boolean(session?.user);

  return (
    // Browser extensions (Scribe, Grammarly, password managers) add their own
    // attributes to <html> before React loads, which React then reports as a
    // hydration mismatch. This silences that for this element's attributes
    // only - it does not extend to the rest of the tree, so a real mismatch
    // inside the app is still reported.
    <html lang="en-GB" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <UnprotectedBanner />
        {showHeader && (
          <header className="site-header">
            <span className="brand">Production board</span>
            <Nav />
            <UserMenu />
          </header>
        )}
        {children}
      </body>
    </html>
  );
}
