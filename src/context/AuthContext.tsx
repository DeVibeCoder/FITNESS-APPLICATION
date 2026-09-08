import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { User } from '@/models'
import { serverAuthService, type ServerUser } from '@/services/serverAuthService'
import { identityLinkService } from '@/services/identityLinkService'
import { onboardingService, type OnboardingAnswers } from '@/services/onboardingService'
import { workoutData } from '@/services/workoutData'
import { cloudSync } from '@/services/cloudSync'
import { storageService } from '@/services/storageService'
import { db } from '@/lib/db'
import { useLiveQuery } from 'dexie-react-hooks'

/**
 * Who is signed in, and whose data that means.
 *
 * Two questions, two answers, deliberately not merged. The server says who is
 * signed in — a Better Auth session in an httpOnly cookie this code cannot
 * read or forge. The local link says which Dexie profile that account reads on
 * this device. The second is a lookup, never a permission: every protected
 * request is authorised by the cookie, on the server, again.
 *
 * There is now exactly one authority, and it is not this file.
 *
 * There used to be two. When `/api/auth` did not answer, the application fell
 * back to a local sign-in — a handle and a password checked against
 * IndexedDB — and that fallback was a second way in that no server had ever
 * agreed to. It is gone. `authService` moved to `scripts/fixtures`, nothing in
 * `src` imports it, and a deployment whose backend cannot authenticate now
 * says so and admits nobody, which is the honest answer.
 *
 * `status` is likewise the server's word and only the server's. A pending
 * account resolves no profile, enables no cloud path and reaches no screen —
 * not because a route hides one, but because this provider never hands out a
 * `user` for it to render. Clearing localStorage or editing IndexedDB changes
 * what this device remembers and nothing about what it is allowed to do.
 */
interface AuthValue {
  /** The Dexie profile whose data is shown. Only ever set for an approved account. */
  user: User | null
  /** The authenticated account. The one thing any decision is made from. */
  serverUser: ServerUser | null
  ready: boolean
  /** True once a server session exists but no local profile is chosen yet. */
  needsLink: boolean
  /** Whether this deployment can authenticate anybody at all. */
  backend: 'ready' | 'unavailable'
  signIn: (email: string, password: string) => Promise<ServerUser>
  signUp: (input: SignUpInput) => Promise<ServerUser>
  signOut: () => Promise<void>
  /** Re-asks the server who this is. The pending screen's only mechanism. */
  refresh: () => Promise<void>
  linkExisting: (localUserId: string) => Promise<void>
  startFresh: () => Promise<void>
  /** True when `id` is the profile being shown — the only one editable. */
  isOwner: (id: string) => boolean
}

/**
 * What setup sends. The credentials go to the server; the answers stay on this
 * device until approval gives them a profile to live on.
 */
export interface SignUpInput {
  email: string
  password: string
  name: string
  onboarding?: OnboardingAnswers
}

const AuthContext = createContext<AuthValue | null>(null)

/**
 * How often the browser re-asks the server who it is.
 *
 * Fast while waiting on a decision, because that is a person watching a screen
 * for an answer that arrives from somebody else's device. Slow once approved,
 * because then it is only a safety net: a rejection or a disabling deletes the
 * account's sessions server-side, so the very next API call already fails —
 * this is what closes an idle tab's window before it makes one.
 *
 * Deliberately polling rather than a socket. The realtime Durable Object is
 * the chat's, it is reached through a route that refuses anything but an
 * approved account, and an approval is a once-per-account event — a WebSocket
 * for it would be new infrastructure carrying one message. The important
 * property is not the transport: it is that the client learns nothing from the
 * signal itself and re-asks the authenticated API, which is the only thing
 * that can actually say yes.
 */
const POLL_PENDING_MS = 4000
const POLL_APPROVED_MS = 60000

/**
 * How often an open tab re-reads the group's data.
 *
 * Half a minute is a compromise between a feed that feels live and twenty
 * requests a person did not ask for. Anything somebody does on this device
 * appears immediately regardless — the local write happens first and the
 * screens read it through a live query — so this interval only governs how
 * quickly *other people's* changes arrive.
 */
const DATA_REFRESH_MS = 30000

/**
 * Sends a just-created profile up, once.
 *
 * Never throws: the local row is already correct and the person is already in
 * the application. A failed profile push means the group roster shows a
 * default colour until the next profile edit, which is not a reason to stop
 * somebody entering.
 */
async function pushFreshProfile(localUserId: string): Promise<void> {
  const profile = await db.users.get(localUserId)
  if (!profile) return
  await cloudSync.pushProfile({
    name: profile.name,
    handle: profile.handle,
    avatarColor: profile.avatarColor,
    birthDate: profile.birthDate,
    sex: profile.sex,
    heightCm: profile.heightCm,
    startWeightKg: profile.startWeightKg,
    targetWeightKg: profile.targetWeightKg,
    goal: profile.goal,
    activityLevel: profile.activityLevel,
    stepGoal: profile.stepGoal,
    waterGoalL: profile.waterGoalL,
    workoutsPerWeekGoal: profile.workoutsPerWeekGoal,
    weighInDay: profile.weighInDay,
    workoutApps: profile.workoutApps,
    units: profile.units,
  })
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null)
  const [serverUser, setServerUser] = useState<ServerUser | null>(null)
  const [backend, setBackend] = useState<'ready' | 'unavailable'>('ready')
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

  /** Everything that must be true when nobody approved is signed in. */
  const detach = useCallback(async () => {
    workoutData.useCloud(false)
    cloudSync.useCloud(false)
    setNeedsLink(false)
    await adoptLocal(null)
  }, [adoptLocal])

  /**
   * Asks the server who this is, and makes the whole client agree with it.
   *
   * `probe` is only for the first call: `available()` distinguishes a
   * deployment with no backend from one whose session has expired, and that is
   * a boot-time question rather than something worth re-asking every four
   * seconds.
   */
  const resolveSession = useCallback(
    async (options: { probe?: boolean } = {}): Promise<void> => {
      if (options.probe) {
        const available = await serverAuthService.available()
        if (!available) {
          setBackend('unavailable')
          setServerUser(null)
          await detach()
          return
        }
        setBackend('ready')
      }

      const account = await serverAuthService.currentUser()
      setServerUser(account)

      // No session means signed out, whatever this device still remembers.
      if (!account) {
        await detach()
        return
      }

      /*
       * Waiting, turned away or switched off. The account exists and can see
       * its own status; it gets no profile, no cloud path and no screen. The
       * server refuses it too — this is the client agreeing, not the client
       * deciding.
       */
      if (account.status !== 'approved') {
        await detach()
        return
      }

      const resolution = await identityLinkService.resolve(account)
      if (resolution.kind === 'linked') {
        await adoptLocal(resolution.localUserId)
        workoutData.useCloud(true)
        /*
         * Hydrating pulls this account's rows down into the device's cache; it
         * never pushes the device's existing history up.
         */
        cloudSync.useCloud(true, resolution.localUserId, account.id)
        void cloudSync.sync(true)
        setNeedsLink(false)
        return
      }

      /*
       * Nothing on this device to choose between, so there is no question to
       * ask. This is the ordinary path now that the demo group is gone: a
       * fresh browser holds no profiles at all, and stopping to ask which of
       * zero histories belongs to you would be a screen with one button.
       */
      if (resolution.localUsers.length === 0) {
        /*
         * Ask the server what it already knows before inventing anything.
         *
         * The cloud switch goes on first because `ownProfile` reads through
         * the same client as everything else, and it is off until told
         * otherwise. Then:
         *
         *   a profile exists  → adopt it. This device is joining an account,
         *                       not authoring one.
         *   nothing there yet → this is the first device for a new account, so
         *                       setup's answers go up.
         *
         * It used to do only the second, unconditionally, which meant signing
         * in on a second device wrote a placeholder profile over the real one
         * in D1 — the way a real administrator's handle became
         * `member_c35b6e`.
         */
        cloudSync.useCloud(true, null, account.id)
        const serverProfile = await cloudSync.ownProfile()

        const localUserId = await identityLinkService.startFresh(account, serverProfile)
        await adoptLocal(localUserId)
        workoutData.useCloud(true)
        cloudSync.useCloud(true, localUserId, account.id)

        // Only when the server has nothing of its own to lose.
        if (!serverProfile || serverProfile.heightCm === undefined) {
          await pushFreshProfile(localUserId)
        }
        void cloudSync.sync(true)
        setNeedsLink(false)
        return
      }

      // Signed in, and this device holds history nobody has claimed yet.
      workoutData.useCloud(false)
      cloudSync.useCloud(false)
      await adoptLocal(null)
      setNeedsLink(true)
    },
    [adoptLocal, detach],
  )

  useEffect(() => {
    let cancelled = false
    void resolveSession({ probe: true })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [resolveSession])

  /**
   * The re-ask, from a timer and from the tab coming back.
   *
   * A failure here is left alone on purpose. A dropped network is not a
   * signing-out, and treating it as one would throw somebody out of the app
   * for walking into a lift.
   */
  const refresh = useCallback(async () => {
    try {
      await resolveSession()
    } catch {
      // Transient. The next tick asks again.
    }
  }, [resolveSession])

  /*
   * Kept in a ref so the interval below is not torn down and rebuilt on every
   * render — only when the polling *rate* should change.
   */
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  const watching = ready && backend === 'ready' && serverUser !== null
  const period = serverUser?.status === 'approved' ? POLL_APPROVED_MS : POLL_PENDING_MS

  useEffect(() => {
    if (!watching) return
    const tick = () => void refreshRef.current()

    const timer = setInterval(tick, period)

    /*
     * And the data, not just the session.
     *
     * The status poll above answers "am I still allowed in". This answers "has
     * anything changed", which is the question a person actually has when they
     * come back to the tab — somebody else's post, a reply in the chat, a
     * weigh-in logged on their phone. `cloudSync.sync` throttles and joins
     * overlapping runs, so firing it from several events is safe.
     */
    const pull = () => void cloudSync.sync()
    const dataTimer = setInterval(pull, DATA_REFRESH_MS)
    // Coming back to the tab is the moment a stale answer is most likely and
    // most visible, so it is worth one immediate ask.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      tick()
      // Forced: coming back to the app is exactly when a stale screen is most
      // visible, and is worth the round trips.
      void cloudSync.sync(true)
    }
    const onFocus = () => {
      tick()
      pull()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onFocus)

    return () => {
      clearInterval(timer)
      clearInterval(dataTimer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onFocus)
    }
  }, [watching, period])

  // Live so profile edits show up immediately everywhere.
  const live = useLiveQuery(() => (userId ? db.users.get(userId) : undefined), [userId])
  const user = userId ? (live ?? resolved) : null

  const signIn = useCallback(
    async (email: string, password: string) => {
      const account = await serverAuthService.signIn({ email, password })
      if (!account) throw new Error('Signed in, but the session could not be read back.')
      await resolveSession()
      return account
    },
    [resolveSession],
  )

  const signUp = useCallback(
    async ({ onboarding, ...credentials }: SignUpInput) => {
      const account = await serverAuthService.signUp(credentials)
      if (!account) throw new Error('The account was created, but could not be read back.')
      /*
       * Stored before the session is resolved, not after. The account arrives
       * `pending` so nothing would read these yet — but "nothing would" is a
       * fact about today's default, and the ordering that does not depend on
       * it costs one line.
       */
      if (onboarding) await onboardingService.remember(account.id, onboarding)
      // Pending, because the server said so. Nothing here overrides it.
      await resolveSession()
      return account
    },
    [resolveSession],
  )

  const signOut = useCallback(async () => {
    try {
      await serverAuthService.signOut()
    } catch {
      // The cookie may already be gone. Leaving anyway.
    }
    setServerUser(null)
    await detach()
  }, [detach])

  const linkExisting = useCallback(
    async (localUserId: string) => {
      if (!serverUser) throw new Error('Not signed in.')
      if (serverUser.status !== 'approved') throw new Error('This account is not approved yet.')
      // The service refuses a claim on data another account already holds.
      await identityLinkService.link(serverUser.id, localUserId)
      await adoptLocal(localUserId)
      workoutData.useCloud(true)
      cloudSync.useCloud(true, localUserId, serverUser.id)
      void cloudSync.sync(true)
      setNeedsLink(false)
    },
    [serverUser, adoptLocal],
  )

  const startFresh = useCallback(async () => {
    if (!serverUser) throw new Error('Not signed in.')
    if (serverUser.status !== 'approved') throw new Error('This account is not approved yet.')
    const localUserId = await identityLinkService.startFresh(serverUser)
    await adoptLocal(localUserId)
    workoutData.useCloud(true)
    cloudSync.useCloud(true, localUserId, serverUser.id)
    void cloudSync.sync(true)
    setNeedsLink(false)
  }, [serverUser, adoptLocal])

  const value = useMemo<AuthValue>(
    () => ({
      user,
      serverUser,
      ready,
      needsLink,
      backend,
      signIn,
      signUp,
      signOut,
      refresh,
      linkExisting,
      startFresh,
      isOwner: (id: string) => id === userId,
    }),
    [
      user,
      serverUser,
      ready,
      needsLink,
      backend,
      signIn,
      signUp,
      signOut,
      refresh,
      linkExisting,
      startFresh,
      userId,
    ],
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

/**
 * Whether the signed-in account is an administrator.
 *
 * Reads the server's answer, never the local profile. The local row is a
 * cache of a person's own data and is editable by whoever holds the device —
 * a `role` field in IndexedDB is a wish, not a fact. This only decides what to
 * draw; `requireAdmin` decides what happens, on the server, per request.
 */
export function useIsAdmin(): boolean {
  const { serverUser } = useAuth()
  return serverUser?.role === 'admin'
}
