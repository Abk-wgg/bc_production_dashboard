/**
 * Where sign-in is allowed to send someone afterwards.
 *
 * The URL comes in as a query parameter, so anyone can put anything in it.
 * Without this check a crafted link would send a colleague through our genuine
 * Microsoft sign-in and then bounce them out to another site - which is what a
 * convincing phishing flow looks like, with our own domain lending it
 * credibility.
 *
 * Only same-site paths are allowed. Anything else falls back to the board.
 */
export function safeCallbackUrl(value: string | undefined): string {
  if (!value) return "/";

  if (!value.startsWith("/")) return "/";

  // A second slash - forward or back - makes it protocol-relative:
  // "//evil.example.com" is another host even though it starts with a slash,
  // and browsers treat a backslash there the same way. Checking the character
  // rather than matching a prefix keeps this readable and escape-proof.
  const second = value[1];
  if (second === "/" || second === "\\") return "/";

  return value;
}
