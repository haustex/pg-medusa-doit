import { defineMiddlewares, validateAndTransformBody } from "@medusajs/framework/http"
import {
  PostAdminDoitAttentionResolve,
  PostAdminDoitSettlementImport,
  PostAdminDoitTestConnection,
  PostAdminDoitWithdrawal,
} from "./admin/doit/validators"
import { PostAdminDoitSettings } from "./admin/doit/settings/validators"
import { DOIT_WEBHOOK_MATCHER, verifyDoitSignature } from "./hooks/verify-doit-signature"

export default defineMiddlewares({
  routes: [
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
