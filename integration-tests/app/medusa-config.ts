import { defineConfig, loadEnv } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

// Started only by integration-tests/run.mjs, which refuses anything but the
// spike Postgres (127.0.0.1:55432) and Redis (127.0.0.1:56379).
const redisUrl = process.env.REDIS_URL!

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl,
    workerMode: (process.env.MEDUSA_WORKER_MODE as "shared" | "worker" | "server") || "shared",
    http: {
      storeCors: "*",
      adminCors: "*",
      authCors: "*",
      jwtSecret: "doit-e2e-jwt",
      cookieSecret: "doit-e2e-cookie",
    },
  },
  admin: { disable: process.env.DOIT_ADMIN !== "1" },
  plugins: [{ resolve: "medusa-payment-doit", options: {} }],
  modules: [
    { resolve: "@medusajs/medusa/event-bus-redis", options: { redisUrl } },
    { resolve: "@medusajs/medusa/workflow-engine-redis", options: { redis: { redisUrl } } },
    {
      resolve: "@medusajs/medusa/locking",
      options: {
        providers: [
          { resolve: "@medusajs/medusa/locking-redis", id: "locking-redis", is_default: true, options: { redisUrl } },
        ],
      },
    },
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        webhook_delay: 500,
        providers: [
          {
            resolve: "medusa-payment-doit/providers/doit",
            id: "doit",
            options: {
              ...(process.env.DOIT_API_BASE_URL ? { api_base_url: process.env.DOIT_API_BASE_URL } : {}),
              rail: (process.env.DOIT_RAIL as "qris") || "qris",
              ...(process.env.DOIT_VA_BANK ? { va_bank: process.env.DOIT_VA_BANK } : {}),
            },
          },
        ],
      },
    },
  ],
})
