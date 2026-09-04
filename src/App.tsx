import { lazy, Suspense, useEffect, useState } from 'react'
import { AccountLink } from '@/pages/AccountLink'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { ThemeProvider } from '@/context/ThemeContext'
import { ToastProvider } from '@/context/ToastContext'
import { AppShell } from '@/layouts/AppShell'
import { LoadingScreen } from '@/components/ui/EmptyState'
import { ensureSeeded } from '@/data/seed'
import { challengeService } from '@/services'
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
    ensureSeeded()
      // Creating the week here keeps every later read side-effect free,
      // which matters because the challenge is read from live queries.
      .then(() => challengeService.ensureWeek(todayKey()))
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

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready, needsLink } = useAuth()
  const location = useLocation()

  if (!ready) return <LoadingScreen />
  /*
   * Signed in, but nobody has said whose data this is yet. Asked once, before
   * any screen can read a profile — the alternative is an application that
   * silently picks one, which is the mistake this screen exists to prevent.
   */
  if (needsLink) return <AccountLink />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <>{children}</>
}
