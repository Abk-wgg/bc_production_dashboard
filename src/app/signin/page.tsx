import { signIn } from "@/auth";
import { safeCallbackUrl } from "@/lib/safe-redirect";

export const dynamic = "force-dynamic";

/**
 * Only a signed-out visitor ever sees this. One button - there is a single way
 * in, so offering choices would only invite the wrong one.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;

  // Only ever return to a path on this site - see safeCallbackUrl.
  const target = safeCallbackUrl(callbackUrl);

  return (
    <main>
      <div className="signin">
        <h1>Production board</h1>
        <p className="sub">Sign in with your Wilson George Microsoft account.</p>

        {error && (
          <div className="notice error" style={{ textAlign: "left" }}>
            <h2>That sign-in did not complete</h2>
            <p>
              If this keeps happening, your account may not have been granted access to
              the board. See <code>AUTH-SETUP.md</code>.
            </p>
          </div>
        )}

        <form
          action={async () => {
            "use server";
            await signIn("microsoft-entra-id", { redirectTo: target });
          }}
        >
          <button type="submit" className="signin-button">
            Sign in with Microsoft
          </button>
        </form>

        <p className="note">
          You do not need a Business Central licence to view the board — it reads BC on
          your behalf.
        </p>
      </div>
    </main>
  );
}
