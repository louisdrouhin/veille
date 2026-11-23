import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// The second login step is handled inline by the login form (no redirect page).
export const authClient = createAuthClient({ plugins: [twoFactorClient()] });
