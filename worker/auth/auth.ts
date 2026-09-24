import { betterAuth, type BetterAuthOptions } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { sendEmail, signInCodeEmail } from "./email.ts";

const timestamps = { createdAt: "created_at", updatedAt: "updated_at" } as const;

/** Public base URL: APP_URL when configured, otherwise the request's own origin. */
export function appBaseUrl(env: Env, request: Request): string {
  return env.APP_URL || new URL(request.url).origin;
}

/**
 * Better Auth with passwordless email OTP ("skriv e-post → motta kode → logg inn").
 * Table/column names map onto db/migrations/0001_auth.sql.
 */
export function authOptions(env: Env, baseURL: string) {
  return {
    appName: "Slump Bryggeri",
    baseURL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    telemetry: { enabled: false },
    user: { modelName: "users", fields: { emailVerified: "email_verified", ...timestamps } },
    session: {
      modelName: "sessions",
      fields: { expiresAt: "expires_at", ipAddress: "ip_address", userAgent: "user_agent", userId: "user_id", ...timestamps },
      expiresIn: 60 * 60 * 24 * 60,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    account: {
      modelName: "accounts",
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        ...timestamps,
      },
    },
    verification: { modelName: "verifications", fields: { expiresAt: "expires_at", ...timestamps } },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 10 * 60,
        allowedAttempts: 5,
        storeOTP: "hashed",
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== "sign-in") return;
          await sendEmail(env, baseURL, signInCodeEmail(email, otp));
        },
      }),
    ],
  } satisfies BetterAuthOptions;
}

export function createAuth(env: Env, request: Request) {
  return betterAuth(authOptions(env, appBaseUrl(env, request)));
}

export type Auth = ReturnType<typeof createAuth>;
