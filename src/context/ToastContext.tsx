import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import styles from './Toast.module.css'

interface Toast {
  id: number
  message: string
  tone: 'default' | 'success' | 'error'
}

interface ToastValue {
  show: (message: string, tone?: Toast['tone']) => void
  /**
   * Runs an action and, if it throws, shows a friendly message instead of the
   * raw error. Nothing technical ever reaches the screen.
   */
  guard: <T>(action: () => Promise<T>, failureMessage?: string) => Promise<T | undefined>
}

const ToastContext = createContext<ToastValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const show = useCallback((message: string, tone: Toast['tone'] = 'default') => {
    const id = nextId.current++
    setToasts((current) => [...current, { id, message, tone }])
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id))
    }, 3200)
  }, [])

  const guard = useCallback(
    async <T,>(action: () => Promise<T>, failureMessage = "That didn't save. Try again.") => {
      try {
        return await action()
      } catch (error) {
        console.error(error)
        // Ownership refusals already read like a sentence a person would say;
        // everything else gets the friendly fallback instead of a raw error.
        const isOwnership = error instanceof Error && error.name === 'OwnershipError'
        show(isOwnership ? error.message : failureMessage, 'error')
        return undefined
      }
    },
    [show],
  )

  const value = useMemo(() => ({ show, guard }), [show, guard])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.stack} role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`${styles.toast} ${styles[toast.tone]}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastValue {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast must be used inside ToastProvider')
  return value
}
