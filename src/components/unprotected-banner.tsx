import { isAuthConfigured } from "@/lib/auth-config";

/**
 * Says plainly that the board has no sign-in yet.
 *
 * The point is that the unprotected state can never be mistaken for a secured
 * one. It disappears by itself the moment the Entra values are filled in - it
 * is not something anyone has to remember to remove.
 */
export default function UnprotectedBanner() {
  if (isAuthConfigured()) return null;

  return (
    <div className="unprotected">
      <strong>No sign-in configured.</strong> Anyone who can reach this URL can read
      the board. Fine for a demo on the internal network — not for leaving up.
    </div>
  );
}
