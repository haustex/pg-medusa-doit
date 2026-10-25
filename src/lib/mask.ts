const MASK = "••••"
// Below this length the last 4 characters are too large a share of the secret.
const MIN_LENGTH_TO_REVEAL = 12

/**
 * Masks a secret for display: keeps a `pb_test_` / `pb_live_` prefix (it only
 * tells the environment) and the last 4 characters, e.g. "pb_test_••••a1b2".
 */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }
  const prefix = value.match(/^pb_(test|live)_/)?.[0] ?? ""
  const rest = value.slice(prefix.length)
  if (rest.length < MIN_LENGTH_TO_REVEAL) {
    return `${prefix}${MASK}`
  }
  return `${prefix}${MASK}${rest.slice(-4)}`
}
