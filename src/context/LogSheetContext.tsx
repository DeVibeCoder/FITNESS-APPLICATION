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

/**
 * What a caller can hand the sheet to start with.
 *
 * Only text, and only the post composer reads it. Sharing a workout means the
 * card that knows about the workout turns it into a sentence and hands over
 * the sentence — the composer never learns what a workout is, which is what
 * keeps it a post composer rather than a record picker.
 */
export interface LogDraft {
  text?: string
}

interface LogSheetValue {
  open: (mode?: LogMode, draft?: LogDraft) => void
}

const LogSheetContext = createContext<LogSheetValue | null>(null)

/** One quick-log sheet for the whole app, openable from anywhere. */
export function LogSheetProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; mode: LogMode; draft?: LogDraft }>({
    open: false,
    mode: 'menu',
  })

  const open = useCallback(
    (mode: LogMode = 'menu', draft?: LogDraft) => setState({ open: true, mode, draft }),
    [],
  )
  const close = useCallback(() => setState((current) => ({ ...current, open: false })), [])
  const value = useMemo(() => ({ open }), [open])

  return (
    <LogSheetContext.Provider value={value}>
      {children}
      <LogSheet
        open={state.open}
        onClose={close}
        initialMode={state.mode}
        draft={state.draft}
      />
    </LogSheetContext.Provider>
  )
}

export function useLogSheet(): LogSheetValue {
  const value = useContext(LogSheetContext)
  if (!value) throw new Error('useLogSheet must be used inside LogSheetProvider')
  return value
}
