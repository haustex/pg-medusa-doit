import { useEffect, useState } from "react"

/**
 * Haus Kayu teak, used sparingly (chart bars, the balance card). Everything
 * else uses the Admin's semantic colours. Applied as inline styles because
 * plugin sources are not part of the Admin's Tailwind build.
 */
export const ACCENT = { light: "#8B5E3C", dark: "#C9925E", soft: "rgba(139, 94, 60, 0.12)", softDark: "rgba(201, 146, 94, 0.18)" }

export function useIsDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"))
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])
  return dark
}

export function useAccent() {
  const dark = useIsDark()
  return { color: dark ? ACCENT.dark : ACCENT.light, soft: dark ? ACCENT.softDark : ACCENT.soft }
}
