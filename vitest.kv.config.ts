import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./db/migrations");

  return {
    plugins: [
      cloudflareTest({
        main: "./worker/index.ts",
        wrangler: { configPath: "./wrangler.kv-test.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-for-better-auth",
            RESEND_API_KEY: "",
            BREWERY_ACCESS_CODE: "",
            APP_URL: "http://localhost",
          },
        },
      }),
    ],
    test: {
      include: ["tests/integration/attachments-kv.test.ts"],
      setupFiles: ["./tests/integration/setup.ts"],
    },
  };
});
