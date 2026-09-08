import { lazy, Suspense, useEffect, useState } from 'react'
import { AccountLink } from '@/pages/AccountLink'
import { Pending } from '@/pages/Pending'
import { BackendUnavailable } from '@/pages/BackendUnavailable'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { ThemeProvider } from '@/context/ThemeContext'
import { ToastProvider } from '@/context/ToastContext'
import { AppShell } from '@/layouts/AppShell'
import { LoadingScreen } from '@/components/ui/EmptyState'
import { challengeService } from '@/services'
import { installReferenceData } from '@/data/reference'
import { todayKey } from '@/utils/date'
import { Login } from '@/pages/Login'
import { Home } from '@/pages/Home'
import { BootError } from '@/pages/BootError'

/**
 * Everything past the first screen loads on demand.
 *
 * Login and Home are what a phone opens to, so they stay in the main bundle.
 * The rest — charts, the workout player, the scanner — are a tap away at most,
 * and there is no reason to make someone download the food scanner before they
 * have seen their morning greeting.
 */
const Setup = lazy(() => import('@/pages/Setup').then((m) => ({ default: m.Setup })))
const Activity = lazy(() => import('@/pages/Activity').then((m) => ({ default: m.Activity })))
const Me = lazy(() => import('@/pages/Me').then((m) => ({ default: m.Me })))
const Notifications = lazy(() => import('@/pages/Notifications').then((m) => ({ default: m.Notifications })))
const Workout = lazy(() => import('@/pages/Workout').then((m) => ({ default: m.Workout })))
const WorkoutPlan = lazy(() => import('@/pages/WorkoutPlan').then((m) => ({ default: m.WorkoutPlan })))
const WorkoutHistory = lazy(() => import('@/pages/WorkoutHistory').then((m) => ({ default: m.WorkoutHistory })))
const WorkoutPlayer = lazy(() => import('@/pages/WorkoutPlayer').then((m) => ({ default: m.WorkoutPlayer })))
const Nutrition = lazy(() => import('@/pages/Nutrition').then((m) => ({ default: m.Nutrition })))
const Progress = lazy(() => import('@/pages/Progress').then((m) => ({ default: m.Progress })))
const OurProgress = lazy(() => import('@/pages/OurProgress').then((m) => ({ default: m.OurProgress })))
const GroupLayout = lazy(() => import('@/layouts/GroupLayout').then((m) => ({ default: m.GroupLayout })))
const GroupOverview = lazy(() => import('@/pages/GroupOverview').then((m) => ({ default: m.GroupOverview })))
const GroupAwards = lazy(() => import('@/pages/GroupAwards').then((m) => ({ default: m.GroupAwards })))
const MyActivity = lazy(() => import('@/pages/MyActivity').then((m) => ({ default: m.MyActivity })))
const Admin = lazy(() => import('@/pages/Admin').then((m) => ({ default: m.Admin })))
const ChatHome = lazy(() => import('@/pages/ChatHome').then((m) => ({ default: m.ChatHome })))
const ChatThread = lazy(() => import('@/pages/ChatThread').then((m) => ({ default: m.ChatThread })))
const GroupChallenge = lazy(() => import('@/pages/GroupChallenge').then((m) => ({ default: m.GroupChallenge })))
const Updates = lazy(() => import('@/pages/Updates').then((m) => ({ default: m.Updates })))
const WeeklyReview = lazy(() => import('@/pages/WeeklyReview').then((m) => ({ default: m.WeeklyReview })))
const Motivation = lazy(() => import('@/pages/Motivation').then((m) => ({ default: m.Motivation })))
const More = lazy(() => import('@/pages/More').then((m) => ({ default: m.More })))
const Profile = lazy(() => import('@/pages/Profile').then((m) => ({ default: m.Profile })))
const Member = lazy(() => import('@/pages/Member').then((m) => ({ default: m.Member })))

export default function App() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')

  useEffect(() => {
    let cancelled = false
    /*
     * The catalogue, and nothing else.
     *
     * This used to seed a demo group: three invented people, their months of
     * training, and a shared password the sign-in screen printed. All of that
     * has left `src` entirely — it lives in `scripts/fixtures`, which no
     * import path from here can reach — so there is no branch to disable and
     * no build flag to get wrong. A first visit, in development exactly as in
     * production, finds an empty application behind a real sign-in.
     *
     * What remains is the exercise catalogue and the plan templates: facts
     * about the app, owned by nobody, which the workout screens read out of
     * Dexie and must therefore find there.
     */
    const boot = async () => {
      await installReferenceData()
      // Creating the week here keeps every later read side-effect free,
      // which matters because the challenge is read from live queries.
      await challengeService.ensureWeek(todayKey())
    }

    boot()
      .then(() => !cancelled && setStatus('ready'))
      .catch((error) => {
        console.error(error)
        if (!cancelled) setStatus('failed')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (status === 'failed') return <BootError />
  if (status === 'loading') return <LoadingScreen label="Getting your data ready" />

  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}

function AppRoutes() {
  return (
    // One boundary around the routes: a lazy page briefly shows the same
    // spinner the app already uses while loading, rather than a blank frame.
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/setup" element={<Setup />} />

        {/* Workout mode lives outside the shell: no bottom bar, no distractions. */}
        <Route
          path="/workout/play"
          element={
            <RequireAuth>
              <WorkoutPlayer />
            </RequireAuth>
          }
        />

        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          {/* --- The seven primary destinations ------------------------- */}
          <Route index element={<Home />} />

          {/*
            Activity, and its one child. Nutrition is a sub-page of Activity
            rather than a top-level screen: it is reached from the calories
            card, the Activity tab stays lit while it is open, and back comes
            straight here. Nesting it in the path is what makes every one of
            those true without a single special case in the navigation.
          */}
          <Route path="activity" element={<Activity />} />
          <Route path="activity/nutrition" element={<Nutrition />} />
          <Route path="progress" element={<Progress />} />
          <Route path="me" element={<Me />} />

          {/*
            Chat: the list, then the conversation. Two routes rather than one,
            so "back" out of a thread has somewhere honest to go and the tab
            itself is not a teleport.
          */}
          <Route path="chat" element={<ChatHome />} />
          <Route path="chat/thread" element={<ChatThread />} />

          {/*
            Group: one shell, five sections. The layout route is what keeps the
            header and tabs mounted while only the section below them swaps.
          */}
          <Route path="group" element={<GroupLayout />}>
            <Route index element={<GroupOverview />} />
            <Route path="progress" element={<OurProgress />} />
            <Route path="updates" element={<Updates />} />
            <Route path="challenge" element={<GroupChallenge />} />
            <Route path="awards" element={<GroupAwards />} />
          </Route>

          {/* --- Secondary screens -------------------------------------- */}
          <Route path="me/activity" element={<MyActivity />} />
          <Route path="me/admin" element={<Admin />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="workout" element={<Workout />} />
          <Route path="workout/plan" element={<WorkoutPlan />} />
          <Route path="workout/logs" element={<WorkoutHistory />} />
          <Route path="review" element={<WeeklyReview />} />
          <Route path="motivation" element={<Motivation />} />
          <Route path="more" element={<More />} />
          <Route path="profile" element={<Profile />} />
          <Route path="u/:userId" element={<Member />} />

          {/*
            Compatibility. Every path this app has ever linked to still lands
            somewhere sensible — a bookmark or a shared link from before the
            reorganisation must not 404 into the feed.
          */}
          <Route path="nutrition" element={<Navigate to="/activity/nutrition" replace />} />
          {/*
            Achievements had a screen of its own that showed the same grid as
            Group → Awards now shows, only without the detail overlay. One set,
            one screen.
          */}
          <Route path="achievements" element={<Navigate to="/group/awards" replace />} />
          <Route path="group/overview" element={<Navigate to="/group" replace />} />
          <Route path="group/chat" element={<Navigate to="/chat/thread" replace />} />
          <Route path="chat/group" element={<Navigate to="/chat/thread" replace />} />
          <Route path="updates" element={<Navigate to="/group/updates" replace />} />
          <Route path="workout/history" element={<Navigate to="/workout/logs" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

/**
 * The gate every screen in the application sits behind.
 *
 * The order of these checks is the security model, written out. Each one is
 * answered from `serverUser` — what the server said, this boot and every poll
 * since — and never from the local profile, localStorage or the URL. There is
 * no path through here that a different address bar, a cleared storage or an
 * edited IndexedDB row reaches; the only way past the status check is for the
 * server to start answering differently.
 *
 * And it is not the boundary. It is the courtesy. Every request the screens
 * behind it make is authorised again by `requireApprovedUser` against the D1
 * user row, so a person who defeats all of this gets the screens and 403 from
 * everything on them.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, serverUser, ready, needsLink, backend } = useAuth()
  const location = useLocation()

  if (!ready) return <LoadingScreen />
  // A deployment that cannot authenticate admits nobody, and says why.
  if (backend === 'unavailable') return <BackendUnavailable />
  if (!serverUser) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  /*
   * Waiting, turned away, or switched off. One screen for all three, because
   * all three mean the same thing here: this account does not enter. It is
   * checked before `needsLink` and before `user`, so no amount of local state
   * can arrange to be asked a different question first.
   */
  if (serverUser.status !== 'approved') return <Pending />
  /*
   * Signed in, and this device holds history nobody has claimed. Asked once,
   * before any screen can read a profile — the alternative is an application
   * that silently picks one, which is the mistake this screen exists to
   * prevent.
   */
  if (needsLink) return <AccountLink />
  // Approved, linked, and the profile row is a moment behind. Not a redirect:
  // bouncing to /login here would sign somebody out for a slow disk read.
  if (!user) return <LoadingScreen />
  return <>{children}</>
}
