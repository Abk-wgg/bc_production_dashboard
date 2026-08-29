"use client";

/**
 * Error boundary for the whole board. In practice this catches Business
 * Central being unreachable, the token request being refused, or a web service
 * having been renamed - the app has no other moving parts.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main>
      <div className="notice error">
        <h2>Could not load from Business Central</h2>
        <p>{error.message}</p>
        <p>
          Usually this is one of: the Entra client secret has expired, the app registration
          has lost its Business Central permission, or a published web service has been
          renamed. <code>BC-SETUP.md</code> covers all three.
        </p>
        <p>
          <button type="button" onClick={reset}>
            Try again
          </button>
        </p>
      </div>
    </main>
  );
}
