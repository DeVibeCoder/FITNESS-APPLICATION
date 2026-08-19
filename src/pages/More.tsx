import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, ChevronRight, LogOut, Moon, RotateCcw, Sun, SunMoon } from 'lucide-react'
import { db } from '@/lib/db'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, Section } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Avatar } from '@/components/ui/Avatar'
import { Sheet } from '@/components/ui/Sheet'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/context/ThemeContext'
import { useToast } from '@/context/ToastContext'
import { resetDatabase } from '@/data/seed'
import { hasRole } from '@/services'
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
  const { show, guard } = useToast()
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)

  const members = useLiveQuery(() => db.users.toArray(), [])

  if (!user) return null

  const reset = async () => {
    setResetting(true)
    const result = await guard(() => resetDatabase(), "Couldn't reset the data. Try again.")
    setResetting(false)
    setConfirmReset(false)
    if (result !== undefined) show('Demo data restored.', 'success')
  }

  return (
    <div className={styles.page}>
      <PageHeader title="Privacy & data" backTo="/me" />

      {/*
        Privacy and data only. Workouts, progress, nutrition, the weekly
        review, achievements and motivation are not privacy settings — they
        live in Activity, Group and Me, and listing them here again is what
        made this page a menu instead of a settings screen.
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
                {user.name} · @{user.handle}
                {user.email ? ` · ${user.email}` : ''}
              </p>
            </div>
            <span className={styles.pill}>{hasRole(user, 'admin') ? 'Admin' : 'Member'}</span>
          </div>

          <div className={styles.setting}>
            <div className={styles.settingText}>
              <p className={styles.settingLabel}>Sign-in security</p>
              <p className={styles.settingHint}>
                Your password is stored on this device as a salted digest. That keeps it out
                of plain sight, but it is not protection — anyone with this device can read
                the database. Real security arrives with the server.
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
            <p className={styles.dataTitle}>Everything is on this device</p>
            <p className={styles.dataBody}>
              Your logs live in this browser's storage. Nothing is uploaded anywhere. When the group
              moves to a shared server, this data comes with you.
            </p>
          </div>
          <Button
            variant="secondary"
            icon={<RotateCcw size={15} strokeWidth={2.2} />}
            onClick={() => setConfirmReset(true)}
          >
            Reset to demo data
          </Button>
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
        Circuit · {firstName(user.name)}'s device · <span className="tnum">v0.1</span>
      </p>

      <Sheet
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset to demo data?"
        subtitle="This wipes every log on this device and restores the sample history."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmReset(false)}>
              Keep my data
            </Button>
            <Button variant="danger" onClick={reset} disabled={resetting}>
              {resetting ? 'Resetting…' : 'Reset everything'}
            </Button>
          </>
        }
      >
        <div className={styles.warning}>
          <span className={styles.warningIcon}>
            <AlertTriangle size={18} strokeWidth={2.1} />
          </span>
          <p>
            Every workout, weigh-in, meal and check-in for all members on this device will be
            replaced. There is no undo.
          </p>
        </div>
      </Sheet>
    </div>
  )
}
