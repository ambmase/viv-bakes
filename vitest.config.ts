import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));

  return {
    test: {
      // Two projects, because the admin's WebP encoder cannot run in the
      // Workers pool: it is browser code that loads a .wasm through fetch, and
      // it is the one piece of client logic worth testing for real rather than
      // by hand on a phone. Everything else still runs in the Worker runtime
      // against real D1 and R2.
      projects: [
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: "./wrangler.jsonc" },
              miniflare: {
                bindings: {
                  TEST_MIGRATIONS: migrations,
                  ACCESS_TEAM_DOMAIN: "https://vivbakes-test.cloudflareaccess.com",
                  ACCESS_AUD: "test-audience-tag",
                  ADMIN_EMAILS: "admin@example.com, viv@example.com",
                },
              },
            }),
          ],
          test: {
            name: "worker",
            setupFiles: ["./test/apply-migrations.ts"],
            exclude: ["**/node_modules/**", "test/webp-encode.test.ts"],
          },
        },
        {
          test: {
            name: "encoder",
            environment: "node",
            include: ["test/webp-encode.test.ts"],
          },
        },
      ],
    },
  };
});
