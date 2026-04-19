// Public session helpers. Logto is the sole auth path; the password-based
// settings_auth cookie is being phased out along with /api/auth/login.
export { getSession, logtoConfig } from "./logto";
export type { Session } from "./logto";
export { isAdmin, resolveSections } from "./access";
export type { Section } from "./access";
