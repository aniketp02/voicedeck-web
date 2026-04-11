import { createContext } from 'react'

import type { Theme } from '@/lib/theme'

export type ThemeCtxValue = {
  theme: Theme
  setTheme: (t: Theme) => void
  toggleTheme: () => void
}

export const ThemeContext = createContext<ThemeCtxValue | null>(null)
