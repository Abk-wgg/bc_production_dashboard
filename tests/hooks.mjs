// Module resolution hook, loaded off-thread by tests/ts-resolver.mjs.
//
// The app is bundled by Next, so its imports are extensionless ("./types") and
// use the "@/..." alias. Node's ESM resolver wants a real file. This fills both
// gaps, so tests import the same modules the app ships rather than a compiled
// copy that could drift from it.

const root = new URL("../", import.meta.url).href;

export async function resolve(specifier, context, next) {
  // "@/lib/board" -> "<root>src/lib/board"
  const target = specifier.startsWith("@/")
    ? new URL(`src/${specifier.slice(2)}`, root).href
    : specifier;

  const candidates = /\.(ts|tsx|js|mjs|cjs|json)$/.test(target)
    ? [target]
    : [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`];

  let lastError;
  for (const candidate of candidates) {
    try {
      return await next(candidate, context);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
