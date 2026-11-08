import { v } from "convex/values";
import { modifyAccountCredentials } from "@convex-dev/auth/server";
import { internalAction } from "./_generated/server";

/**
 * One-off admin utility to reset a user's password.
 *
 * Run from the CLI:
 *   npx convex run adminResetPassword:resetPassword '{"email":"user@example.com","password":"newpass"}'
 *
 * This re-hashes the new password with the Password provider's own crypto
 * (Scrypt), so the account can sign in with it normally. Delete this file
 * once you're done — it bypasses the normal reset flow.
 */
export const resetPassword = internalAction({
  args: {
    email: v.string(),
    password: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: {
        id: args.email,
        secret: args.password,
      },
    });
    return null;
  },
});
