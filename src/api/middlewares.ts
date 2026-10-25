import { defineMiddlewares, validateAndTransformBody } from "@medusajs/framework/http"
import { PostAdminDoitSettings } from "./admin/doit/settings/validators"

export default defineMiddlewares({
  routes: [
    {
      matcher: "/admin/doit/settings",
      method: "POST",
      middlewares: [validateAndTransformBody(PostAdminDoitSettings)],
    },
  ],
})
