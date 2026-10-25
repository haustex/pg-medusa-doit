import { defineMiddlewares, validateAndTransformBody, validateAndTransformQuery } from "@medusajs/framework/http"
import { storeRateLimit } from "../lib/store-rate-limit"
import {
  PostAdminDoitAttentionResolve,
  PostAdminDoitSettlementImport,
  PostAdminDoitTestConnection,
  PostAdminDoitWithdrawal,
} from "./admin/doit/validators"
import { PostAdminDoitSettings } from "./admin/doit/settings/validators"
import { GetStoreDoitMethods } from "./store/doit/validators"
import { DOIT_WEBHOOK_MATCHER, verifyDoitSignature } from "./hooks/verify-doit-signature"

export default defineMiddlewares({
  routes: [
    {
      // Storefront polling: ~12/min per cart at the suggested 5 s interval.
      matcher: "/store/doit/carts/:id/payment",
      method: "GET",
      middlewares: [storeRateLimit({ perIp: 120, perCart: 40 })],
    },
    {
      matcher: "/store/doit/methods",
      method: "GET",
      middlewares: [
        storeRateLimit({ perIp: 30, perCart: 20 }),
        validateAndTransformQuery(GetStoreDoitMethods, {}),
      ],
    },
    {
      matcher: "/admin/doit/settings",
      method: "POST",
      middlewares: [validateAndTransformBody(PostAdminDoitSettings)],
    },
    {
      matcher: "/admin/doit/test-connection",
      method: "POST",
      middlewares: [validateAndTransformBody(PostAdminDoitTestConnection)],
    },
    {
      matcher: "/admin/doit/withdrawals",
      method: "POST",
      middlewares: [validateAndTransformBody(PostAdminDoitWithdrawal)],
    },
    {
      matcher: "/admin/doit/withdrawals/import",
      method: "POST",
      // settlement CSVs are sent as a JSON string; allow up to the parser's 2 MB limit
      bodyParser: { sizeLimit: "3mb" },
      middlewares: [validateAndTransformBody(PostAdminDoitSettlementImport)],
    },
    {
      matcher: "/admin/doit/attention/:id/resolve",
      method: "POST",
      middlewares: [validateAndTransformBody(PostAdminDoitAttentionResolve)],
    },
    {
      // Same matcher and body parser as Medusa's own webhook route, so the raw
      // body stays available; the middleware itself skips non-doit providers.
      matcher: DOIT_WEBHOOK_MATCHER,
      methods: ["POST"],
      bodyParser: { preserveRawBody: true },
      middlewares: [verifyDoitSignature],
    },
  ],
})
