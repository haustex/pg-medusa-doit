import { defineMiddlewares, validateAndTransformBody } from "@medusajs/framework/http"
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
      // Same matcher and body parser as Medusa's own webhook route, so the raw
      // body stays available; the middleware itself skips non-doit providers.
      matcher: DOIT_WEBHOOK_MATCHER,
      methods: ["POST"],
      bodyParser: { preserveRawBody: true },
      middlewares: [verifyDoitSignature],
    },
  ],
})
