// Registers the resolution hook in tests/hooks.mjs.
// Test-only - nothing in src/ depends on it.

import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
