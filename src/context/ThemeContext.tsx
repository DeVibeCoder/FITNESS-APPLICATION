import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { storageService, type ThemePref } from '@/services/storageService'

interface ThemeValue {
  pref: ThemePref
  setPref: (pref: ThemePref) => void
  /** What is actually on screen right now. */
  resolved: 'light' | 'dark'
}

const ThemeContext = createContext<ThemeValue | null>(null)

function systemDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(() => storageService.getTheme())
  const [systemIsDark, setSystemIsDark] = useState(systemDark)

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setSystemIsDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const resolved: 'light' | 'dark' =
    pref === 'system' ? (systemIsDark ? 'dark' : 'light') : pref

  useEffect(() => {
    const root = document.documentElement
    if (pref === 'system') delete root.dataset.theme
    else root.dataset.theme = pref
    // Keeps the mobile browser chrome in step with the app.
    const color = resolved === 'dark' ? '#111214' : '#f3f2ef'
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((tag) => tag.setAttribute('content', color))
  }, [pref, resolved])

  const setPref = useCallback((next: ThemePref) => {
    storageService.setTheme(next)
    setPrefState(next)
  }, [])

  const value = useMemo(() => ({ pref, setPref, resolved }), [pref, setPref, resolved])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used inside ThemeProvider')
  return value
}
