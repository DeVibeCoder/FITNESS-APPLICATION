import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { User } from '@/models'
import { authService } from '@/services'
import { db } from '@/lib/db'
import { useLiveQuery } from 'dexie-react-hooks'

interface AuthValue {
  user: User | null
  ready: boolean
  signIn: (handle: string, password: string) => Promise<User>
  signOut: () => void
  /** True when `id` is the signed-in user — the only person who may edit. */
  isOwner: (id: string) => boolean
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  /**
   * The user we already hold in hand, so there is never a frame where the
   * session exists but `user` is still null and the router bounces to /login.
   */
  const [resolved, setResolved] = useState<User | null>(null)

  useEffect(() => {
    let cancelled = false
    authService.currentUser().then((current) => {
      if (cancelled) return
      setResolved(current)
      setUserId(current?.id ?? null)
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Live so profile edits show up immediately everywhere.
  const live = useLiveQuery(() => (userId ? db.users.get(userId) : undefined), [userId])
  const user = userId ? (live ?? resolved) : null

  const signIn = useCallback(async (handle: string, password: string) => {
    const next = await authService.signIn(handle, password)
    setResolved(next)
    setUserId(next.id)
    return next
  }, [])

  const signOut = useCallback(() => {
    void authService.signOut()
    setResolved(null)
    setUserId(null)
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      user,
      ready,
      signIn,
      signOut,
      isOwner: (id: string) => id === userId,
    }),
    [user, ready, signIn, signOut, userId],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}

/** For screens that are only reachable when signed in. */
export function useCurrentUser(): User {
  const { user } = useAuth()
  if (!user) throw new Error('No signed-in user')
  return user
}
