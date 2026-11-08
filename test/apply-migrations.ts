import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Setup files run outside per-test-file storage isolation and may run multiple
// times. applyD1Migrations only applies migrations that haven't been applied,
// so calling it here is safe.
await applyD1Migrations(env.DB, (env as unknown as { TEST_MIGRATIONS: [] }).TEST_MIGRATIONS);
