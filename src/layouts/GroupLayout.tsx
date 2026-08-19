import { Outlet } from 'react-router-dom'
import { GroupHeader } from '@/components/group/GroupHeader'
import { GroupTabs } from '@/components/group/GroupTabs'
import styles from './GroupLayout.module.css'

/**
 * The Group shell.
 *
 * Header, tabs, and whichever section is selected. Because this is a layout
 * route rather than something each page renders for itself, React Router keeps
 * the header and the tab strip mounted while only the outlet swaps — so moving
 * from Overview to Awards genuinely does not reset the top of the screen.
 *
 * Group sections therefore have no back button: you never left Group.
 */
export function GroupLayout() {
  return (
    <div className={styles.shell}>
      <GroupHeader />
      <GroupTabs />
      <div className={styles.section}>
        <Outlet />
      </div>
    </div>
  )
}
