import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./db/migrations");

  return {
    test: {
      projects: [
        {
          test: {
            name: "unit",
            environment: "node",
            include: ["tests/calculations/**/*.test.ts", "tests/domain/**/*.test.ts", "tests/import/**/*.test.ts"],
          },
        },
        {
          plugins: [
            cloudflareTest({
              main: "./worker/index.ts",
              wrangler: { configPath: "./wrangler.jsonc" },
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
            name: "integration",
            include: ["tests/integration/**/*.test.ts"],
            setupFiles: ["./tests/integration/setup.ts"],
          },
        },
      ],
    },
  };
});
