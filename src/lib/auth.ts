// Public session helpers. Logto is the sole auth path for the app itself; the
// Chrome extension has its own bearer-token path (src/lib/proofread/auth.ts).
export { getSession, logtoConfig } from "./logto";
export type { Session, SessionOptions } from "./logto";
export { isAdmin, resolveSections } from "./access";
export type { Section } from "./access";
