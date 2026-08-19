import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { BottomNav } from '@/components/nav/BottomNav'
import { TopBar } from '@/components/nav/TopBar'
import { LogSheetProvider, useLogSheet } from '@/context/LogSheetContext'
import styles from './AppShell.module.css'

/**
 * Mobile: slim top header, content, fixed bottom bar.
 * Desktop (≥64rem): the top bar becomes the navigation and the bottom bar goes
 * away. There is no sidebar — this should feel like a consumer app rather than
 * a dashboard.
 */
export function AppShell() {
  return (
    <LogSheetProvider>
      <Shell />
    </LogSheetProvider>
  )
}

function Shell() {
  const { open } = useLogSheet()
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [pathname])

  return (
    <div className={styles.shell}>
      <TopBar />
      <main className={styles.main}>
        <Outlet />
      </main>
      <BottomNav onCreate={() => open()} />
    </div>
  )
}
