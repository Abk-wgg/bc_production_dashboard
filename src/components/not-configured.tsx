/**
 * Shown when a source could not be read because setup is incomplete, rather
 * than because something failed. Says which env var is missing, so the fix is
 * obvious to whoever is standing in front of it.
 */
export default function NotConfigured({
  what,
  missing,
}: {
  what: string;
  missing?: string;
}) {
  return (
    <div className="notice">
      <h2>{what} is not connected yet</h2>
      <p>
        The app has no credentials for this source, so there is nothing to show. Set{" "}
        <code>{missing ?? "the Business Central environment variables"}</code> in{" "}
        <code>.env.local</code> and restart.
      </p>
      <p>
        The web services are already published in Business Central — the outstanding step
        is the Entra app registration. See <code>BC-SETUP.md</code>.
      </p>
    </div>
  );
}
