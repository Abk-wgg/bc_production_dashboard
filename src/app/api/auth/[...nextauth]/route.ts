// The OAuth callback and session endpoints Auth.js needs. Nothing to configure
// here - the configuration lives in src/auth.ts.

import { handlers } from "@/auth";

export const { GET, POST } = handlers;
