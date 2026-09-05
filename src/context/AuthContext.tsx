import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { User } from '@/models'
import { authService } from '@/services'
import { serverAuthService, type ServerUser } from '@/services/serverAuthService'
import { identityLinkService } from '@/services/identityLinkService'
import { workoutData } from '@/services/workoutData'
import { storageService } from '@/services/storageService'
import { db } from '@/lib/db'
import { useLiveQuery } from 'dexie-react-hooks'

/**
 * Who is signed in, and whose data that means.
 *
 * Two questions, two answers, deliberately not merged. The server says who is
 * signed in — a Better Auth session, in an httpOnly cookie this code cannot
 * read or forge. The local link says which Dexie profile that account reads
 * on this device. The second is a lookup, never a permission: every protected
 * request is authorised by the cookie, on the server, again.
 *
 * The old arrangement had one answer for both, and it was a value the page
 * could write. Clearing localStorage used to be a way to become somebody
 * else; now it is a way to lose nothing at all.
 *
 * `mode` is what keeps the application running while the backend is only
 * partly deployed. When /api/auth answers, the server is the authority. When
 * it is absent — a plain `vite dev`, or the current production build, which
 * has no database bound — the app falls back to the local path it has always
 * used. That fallback is a transitional state, not a second way in: it exists
 * only where no server exists to ask, and it authenticates nothing on the
 * server, because the server does not consult it.
 */
interface AuthValue {
  /** The Dexie profile whose data is shown. */
  user: User | null
  /** The authenticated account, when a server session exists. */
  serverUser: ServerUser | null
  ready: boolean
  /** True once a server session exists but no local profile is chosen yet. */
  needsLink: boolean
  /** Which authority is in force. 'local' only where no backend answers. */
  mode: 'server' | 'local'
  signIn: (handle: string, password: string) => Promise<User>
  signOut: () => void
  linkExisting: (localUserId: string) => Promise<void>
  startFresh: () => Promise<void>
  /** True when `id` is the profile being shown — the only one editable. */
  isOwner: (id: string) => boolean
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null)
  const [serverUser, setServerUser] = useState<ServerUser | null>(null)
  const [mode, setMode] = useState<'server' | 'local'>('local')
  const [needsLink, setNeedsLink] = useState(false)
  const [ready, setReady] = useState(false)
  /**
   * The profile already in hand, so there is never a frame where the session
   * exists but `user` is still null and the router bounces to /login.
   */
  const [resolved, setResolved] = useState<User | null>(null)

  /** Points the existing Dexie ownership path at a profile. */
  const adoptLocal = useCallback(async (localUserId: string | null) => {
    storageService.setSessionUserId(localUserId)
    setUserId(localUserId)
    setResolved(localUserId ? ((await db.users.get(localUserId)) ?? null) : null)
  }, [])

  useEffect(() => {
    let cancelled = false

    const boot = async () => {
      // Ask the server first. Its answer, or its absence, decides everything.
      const available = await serverAuthService.available()
      if (cancelled) return

      if (!available) {
        // No backend to ask. Carry on as the application always has.
        setMode('local')
        workoutData.useCloud(false)
        const current = await authService.currentUser()
        if (cancelled) return
        setResolved(current)
        setUserId(current?.id ?? null)
        setReady(true)
        return
      }

      setMode('server')
      const account = await serverAuthService.currentUser()
      if (cancelled) return
      setServerUser(account)

      if (!account) {
        // No session means signed out, whatever localStorage still holds.
        workoutData.useCloud(false)
        await adoptLocal(null)
        setNeedsLink(false)
        setReady(true)
        return
      }

      const resolution = await identityLinkService.resolve(account)
      if (cancelled) return
      if (resolution.kind === 'linked') {
        await adoptLocal(resolution.localUserId)
        /*
         * Workouts go to the cloud only for an approved account. A pending
         * one can sign in and see its own status, but writing its training
         * to a server that will refuse every request is worse than keeping
         * it where it already works.
         */
        workoutData.useCloud(account.status === 'approved')
        setNeedsLink(false)
      } else {
        // Signed in, but nobody has said whose data this is yet.
        workoutData.useCloud(false)
        await adoptLocal(null)
        setNeedsLink(true)
      }
      setReady(true)
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [adoptLocal])

  // Live so profile edits show up immediately everywhere.
  const live = useLiveQuery(() => (userId ? db.users.get(userId) : undefined), [userId])
  const user = userId ? (live ?? resolved) : null

  /** The legacy local sign-in. Only reachable where no server answers. */
  const signIn = useCallback(async (handle: string, password: string) => {
    const next = await authService.signIn(handle, password)
    setResolved(next)
    setUserId(next.id)
    return next
  }, [])

  const signOut = useCallback(() => {
    if (mode === 'server') void serverAuthService.signOut().catch(() => undefined)
    workoutData.useCloud(false)
    void authService.signOut()
    setServerUser(null)
    setNeedsLink(false)
    setResolved(null)
    setUserId(null)
    storageService.setSessionUserId(null)
  }, [mode])

  const linkExisting = useCallback(
    async (localUserId: string) => {
      if (!serverUser) throw new Error('Not signed in.')
      // The service refuses a claim on data another account already holds.
      await identityLinkService.link(serverUser.id, localUserId)
      await adoptLocal(localUserId)
      workoutData.useCloud(serverUser.status === 'approved')
      setNeedsLink(false)
    },
    [serverUser, adoptLocal],
  )

  const startFresh = useCallback(async () => {
    if (!serverUser) throw new Error('Not signed in.')
    const localUserId = await identityLinkService.startFresh(serverUser)
    await adoptLocal(localUserId)
    workoutData.useCloud(serverUser.status === 'approved')
    setNeedsLink(false)
  }, [serverUser, adoptLocal])

  const value = useMemo<AuthValue>(
    () => ({
      user,
      serverUser,
      ready,
      needsLink,
      mode,
      signIn,
      signOut,
      linkExisting,
      startFresh,
      isOwner: (id: string) => id === userId,
    }),
    [user, serverUser, ready, needsLink, mode, signIn, signOut, linkExisting, startFresh, userId],
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
