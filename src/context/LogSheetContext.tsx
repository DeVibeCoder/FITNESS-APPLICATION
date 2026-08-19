import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { LogSheet } from '@/components/log/LogSheet'

type LogMode =
  | 'menu'
  | 'post'
  | 'story'
  | 'motivation'
  | 'workout'
  | 'weight'
  | 'steps'
  | 'water'
  | 'meal'
  | 'checkin'

interface LogSheetValue {
  open: (mode?: LogMode) => void
}

const LogSheetContext = createContext<LogSheetValue | null>(null)

/** One quick-log sheet for the whole app, openable from anywhere. */
export function LogSheetProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; mode: LogMode }>({
    open: false,
    mode: 'menu',
  })

  const open = useCallback((mode: LogMode = 'menu') => setState({ open: true, mode }), [])
  const close = useCallback(() => setState((current) => ({ ...current, open: false })), [])
  const value = useMemo(() => ({ open }), [open])

  return (
    <LogSheetContext.Provider value={value}>
      {children}
      <LogSheet open={state.open} onClose={close} initialMode={state.mode} />
    </LogSheetContext.Provider>
  )
}

export function useLogSheet(): LogSheetValue {
  const value = useContext(LogSheetContext)
  if (!value) throw new Error('useLogSheet must be used inside LogSheetProvider')
  return value
}
