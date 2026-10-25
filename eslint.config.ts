import { defineConfig, globalIgnores } from "eslint/config"
import medusa from "@medusajs/eslint-plugin"

export default defineConfig([
  // The storefront example follows the Next.js starter's own lint setup; the
  // E2E harness is plain Node scripts, not Medusa code.
  globalIgnores(["examples/**", "integration-tests/**"]),
  ...medusa.configs.recommended,
])
