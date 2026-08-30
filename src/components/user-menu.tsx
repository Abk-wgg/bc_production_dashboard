import { auth, signOut } from "@/auth";
import { isAuthConfigured } from "@/lib/auth-config";

/**
 * Who is signed in, and the way out. A server component, so the sign-out is a
 * plain form post rather than client-side JavaScript - it works even if the
 * page's scripts have not loaded.
 */
export default async function UserMenu() {
  // Asking Auth.js for a session before it is configured throws. Nothing to
  // show in that state anyway - there is nobody signed in.
  if (!isAuthConfigured()) return null;

  const session = await auth();
  if (!session?.user) return null;

  return (
    <div className="user-menu">
      <span className="who" title={session.user.email ?? undefined}>
        {session.user.name ?? session.user.email}
      </span>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/signin" });
        }}
      >
        <button type="submit">Sign out</button>
      </form>
    </div>
  );
}
