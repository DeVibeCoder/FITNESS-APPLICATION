import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, LogOut, Moon, Sun, SunMoon } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, Section } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { useAuth, useIsAdmin } from '@/context/AuthContext'
import { useTheme } from '@/context/ThemeContext'
import { userService } from '@/services'
import { firstName } from '@/utils/format'
import type { ThemePref } from '@/services/storageService'
import styles from './More.module.css'

const THEMES: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: SunMoon },
]

export function More() {
  const { user, signOut } = useAuth()
  const { pref, setPref } = useTheme()
  const isAdmin = useIsAdmin()

  // Members only. A request awaiting a decision belongs on the Admin screen,
  // which is the one place a decision can be made about it.
  const members = useLiveQuery(() => userService.listMembers(), [])

  if (!user) return null

  return (
    <div className={styles.page}>
      <PageHeader title="Settings" subtitle="Privacy, appearance and your data" parent={{ label: 'Me', to: '/me' }} />

      {/*
        One settings destination. Me used to offer "Privacy & data" and
        "Appearance" as two rows that opened this same screen — the second one
        scrolled you past four sections to reach the theme buttons, and neither
        row told you the other existed.

        Settings only. Workouts, progress, nutrition, the weekly review,
        achievements and motivation are not settings — they live in Activity,
        Group and Me, and listing them here again is what made this page a menu
        instead of a settings screen.
      */}
      <Section title="Visibility">
        <div className={styles.settingCard}>
          <div className={styles.setting}>
            <div className={styles.settingText}>
              <p className={styles.settingLabel}>Who can see what you share</p>
              <p className={styles.settingHint}>
                Everything you post, share or log is visible to the three of you and nobody
                else. There is no public feed and no way to make one.
              </p>
            </div>
            <span className={styles.pill}>Group</span>
          </div>

          <div className={styles.setting}>
            <div className={styles.settingText}>
              <p className={styles.settingLabel}>Kept private</p>
              <p className={styles.settingHint}>
                Your age, height, BMI, calorie target, macros and food diary are never shown
                to other members — only to you.
              </p>
            </div>
            <span className={`${styles.pill} ${styles.pillQuiet}`}>Only you</span>
          </div>
        </div>
      </Section>

      <Section title="Media">
        <div className={styles.settingCard}>
          <div className={styles.setting}>
            <div className={styles.settingText}>
              <p className={styles.settingLabel}>Food photos</p>
              <p className={styles.settingHint}>
                Held in memory while a scan runs, then discarded. Never written to storage,
                never uploaded, never logged.
              </p>
            </div>
            <span className={`${styles.pill} ${styles.pillQuiet}`}>Not stored</span>
          </div>

          <div className={styles.setting}>
            <div className={styles.settingText}>
              <p className={styles.settingLabel}>Posts and stories</p>
              <p className={styles.settingHint}>
                Pictures are referenced, not embedded. The database holds a pointer and its
                dimensions — never the image itself.
              </p>
            </div>
            <span className={`${styles.pill} ${styles.pillQuiet}`}>Reference only</span>
          </div>
        </div>
      </Section>

      <Section title="Your account">
        <div className={styles.settingCard}>
          <div className={styles.setting}>
            <div className={styles.settingText}>
              <p className={styles.settingLabel}>Signed in as</p>
              <p className={styles.settingHint}>
                {/*
                  The name and the handle, not the email address. An email is a
                  credential; printing it on a settings screen puts it on the
                  screen of whoever is holding the phone, and tells the person
                  who owns it nothing they did not know.
                */}
                {user.name} · @{user.handle}
              </p>
            </div>
            {/*
              The server's answer, not the local row's. A `role` field in this
              device's IndexedDB is a wish; the badge that reads it would be a
              lie a person could write about themselves. This one comes back
              from `/api/auth/get-session`, and every admin route checks it
              again against the same column.
            */}
            <span className={styles.pill}>{isAdmin ? 'Admin' : 'Member'}</span>
          </div>

          <div className={styles.setting}>
            <div className={styles.settingText}>
              <p className={styles.settingLabel}>Sign-in security</p>
              <p className={styles.settingHint}>
                Your password never reaches this device. It is checked on the server against a
                one-way verifier, and your session is a cookie this page cannot read. Whether
                you are approved, and whether you are an administrator, are answered by the
                server on every single request.
              </p>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Members">
        <Card flush>
          {(members ?? []).map((member) => (
            <Link
              key={member.id}
              to={member.id === user.id ? '/profile' : `/u/${member.id}`}
              className={styles.row}
            >
              <Avatar user={member} size="sm" />
              <span className={styles.rowText}>
                <span className={styles.rowLabel}>{member.name}</span>
                <span className={styles.rowHint}>@{member.handle}</span>
              </span>
              {member.id === user.id ? <span className={styles.you}>You</span> : null}
              <ChevronRight size={17} strokeWidth={2} className={styles.chevron} />
            </Link>
          ))}
        </Card>
        <p className={styles.note}>
          Everyone can see everyone's progress. Only you can edit your own entries.
        </p>
      </Section>

      <Section title="Appearance">
        <div className={styles.themes}>
          {THEMES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              className={[styles.theme, pref === value ? styles.themeActive : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => setPref(value)}
              aria-pressed={pref === value}
            >
              <Icon size={18} strokeWidth={1.9} />
              {label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Data">
        <Card className={styles.dataCard}>
          <div>
            <p className={styles.dataTitle}>Your data is saved to your account</p>
            <p className={styles.dataBody}>
              Your logs are kept with your account and this device holds a copy, so they are
              here when you are offline and there when you sign in somewhere else.
            </p>
          </div>
        </Card>
      </Section>

      <Section title="Account">
        <Card flush>
          <button className={styles.row} onClick={signOut}>
            <span className={styles.icon}>
              <LogOut size={17} strokeWidth={1.9} />
            </span>
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>Sign out</span>
              <span className={styles.rowHint}>Switch to another member</span>
            </span>
          </button>
        </Card>
      </Section>

      <p className={styles.footer}>
        RALLY · {firstName(user.name)}'s device · <span className="tnum">v0.1</span>
      </p>
    </div>
  )
}
