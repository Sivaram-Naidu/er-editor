// Puts the chosen theme on the document (FR-9.3).
//
// The dark palette has existed in `ui/theme/tokens.css` all along, behind
// `:root[data-theme='dark']`. Nothing ever set that attribute, so every token in it was
// unreachable. This hook is the missing half.
//
// `system` is resolved to a concrete value HERE rather than left to a
// `prefers-color-scheme` block in CSS. One resolution point means the attribute is always
// the whole answer to "which palette is showing" — with two, an explicit choice and the
// media query can disagree, and the winner depends on stylesheet order.

import { useEffect } from 'react'

import { useUiStore } from '../../store'

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function useAppliedTheme(): void {
  const theme = useUiStore((state) => state.theme)

  useEffect(() => {
    // `matchMedia` is typed as always present but is genuinely absent under jsdom and in
    // some embedded webviews, so the guard is a runtime check rather than a type one —
    // the same shape as the clipboard check in ExportDialog. A missing one only means the
    // system preference is unknowable, which `light` already covers.
    const media = (globalThis as { matchMedia?: (query: string) => MediaQueryList }).matchMedia?.(
      DARK_QUERY,
    )

    const apply = (): void => {
      const prefersDark = media?.matches ?? false
      const resolved = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme
      document.documentElement.setAttribute('data-theme', resolved)
    }

    apply()

    // Only `system` tracks the OS. An explicit choice is a choice, and must not be
    // revised at sunset because the machine switched itself over.
    if (theme !== 'system' || media === undefined) return

    media.addEventListener('change', apply)
    return () => {
      media.removeEventListener('change', apply)
    }
  }, [theme])
}
