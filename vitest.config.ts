import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` throws outside Next's server conditions; stub it so
      // services/lib modules can be unit-tested in plain Node.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Never touch real provider endpoints from tests. These are fixed test
    // values; no real credentials. Redis/QStash are intentionally unset so
    // code paths degrade to their documented fallbacks.
    env: {
      NODE_ENV: "test",
      APP_ENV: "test",
      NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      RAZORPAY_KEY_ID: "rzp_test_key",
      RAZORPAY_KEY_SECRET: "test_razorpay_secret_0123456789",
      APP_BASE_URL: "https://tarang.example.com",
      PUBLIC_SITE_URL: "https://tarang.example.com",
    },
  },
});
