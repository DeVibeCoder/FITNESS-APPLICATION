import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Card, Section } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { EmptyState } from '@/components/ui/EmptyState'
import { TrendChart } from '@/components/charts/TrendChart'
import { MeasurementForm } from './MeasurementForm'
import type { BodyMeasurement } from '@/models'
import { measurementChange, type MeasurementField } from '@/utils/progress'
import { formatDay } from '@/utils/date'
import { num, signed } from '@/utils/format'
import { EMPTY } from '@/data/messages'
import styles from './MeasurementSection.module.css'

const FIELDS: { key: MeasurementField; label: string; unit: string }[] = [
  { key: 'waistCm', label: 'Waist', unit: 'cm' },
  { key: 'chestCm', label: 'Chest', unit: 'cm' },
  { key: 'hipsCm', label: 'Hips', unit: 'cm' },
  { key: 'armCm', label: 'Arms', unit: 'cm' },
  { key: 'thighCm', label: 'Thighs', unit: 'cm' },
  { key: 'bodyFatPct', label: 'Body fat', unit: '%' },
]

/**
 * Start → current → change for whichever fields the user actually records, and
 * a chart only where there are enough points to draw an honest one.
 *
 * NOT CURRENTLY MOUNTED. Measurements were taken out of Progress in the
 * phase-8 pass: nobody in the group was recording them, so four sections — a
 * table, a chart, a chart selector and a history — were sitting on the screen
 * with nothing in them. This component, `MeasurementForm`, the service, the
 * model and `measurementChange` are all intact and unchanged, so putting them
 * back is a matter of rendering this again from `Progress.tsx`.
 */
export function MeasurementSection({ entries }: { entries: BodyMeasurement[] }) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<BodyMeasurement | null>(null)
  const [charted, setCharted] = useState<MeasurementField>('waistCm')

  const changes = FIELDS.map((field) => ({
    ...field,
    change: measurementChange(entries, field.key),
  })).filter((row) => row.change !== null)

  const chartable = changes.filter((row) => (row.change?.points.length ?? 0) >= 2)
  const active = chartable.find((row) => row.key === charted) ?? chartable[0]

  return (
    <>
      <Section
        title="Measurements"
        action={
          <button className={styles.add} onClick={() => setAdding(true)}>
            <Plus size={14} strokeWidth={2.6} />
            Log
          </button>
        }
      >
        {changes.length === 0 ? (
          <EmptyState
            title={EMPTY.noMeasurements.title}
            body={EMPTY.noMeasurements.body}
            action={
              <Button icon={<Plus size={16} strokeWidth={2.4} />} onClick={() => setAdding(true)}>
                Add your first measurement
              </Button>
            }
          />
        ) : (
          <Card flush>
            <ul className={styles.list}>
              {changes.map(({ key, label, unit, change }) => (
                <li key={key} className={styles.row}>
                  <span className={styles.label}>{label}</span>
                  <span className={styles.values}>
                    <span className={styles.from}>
                      <span className="tnum">{num(change!.first, 1)}</span>
                    </span>
                    <span className={styles.arrow} aria-hidden="true">
                      →
                    </span>
                    <span>
                      <span className="tnum">{num(change!.latest, 1)}</span> {unit}
                    </span>
                  </span>
                  <span
                    className={[
                      styles.change,
                      change!.change < 0
                        ? styles.down
                        : change!.change > 0
                          ? styles.up
                          : styles.flat,
                    ].join(' ')}
                  >
                    {change!.points.length < 2 ? '—' : signed(change!.change)}
                  </span>
                </li>
              ))}
            </ul>
            <p className={styles.note}>
              The scale stalls sometimes. These usually do not.
            </p>
          </Card>
        )}
      </Section>

      {active?.change && active.change.points.length >= 2 ? (
        <Section title="Measurement trend">
          <Card>
            {chartable.length > 1 ? (
              <div className={styles.chips}>
                {chartable.map((row) => (
                  <button
                    key={row.key}
                    className={[styles.chip, row.key === active.key ? styles.chipActive : '']
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => setCharted(row.key)}
                  >
                    {row.label}
                  </button>
                ))}
              </div>
            ) : null}
            <TrendChart
              points={active.change.points}
              unit={active.unit}
              digits={1}
              height={120}
            />
            <p className={styles.chartNote}>
              {active.label} · {formatDay(active.change.firstDate)} to{' '}
              {formatDay(active.change.latestDate)}
            </p>
          </Card>
        </Section>
      ) : null}

      {entries.length > 0 ? (
        <Section title="Measurement history">
          <Card flush>
            <ul className={styles.history}>
              {[...entries]
                .sort((a, b) => (a.date < b.date ? 1 : -1))
                .map((entry) => (
                  <li key={entry.id}>
                    <button className={styles.historyRow} onClick={() => setEditing(entry)}>
                      <span className={styles.historyDate}>{formatDay(entry.date)}</span>
                      <span className={styles.historyValues}>
                        {FIELDS.filter((field) => typeof entry[field.key] === 'number').map(
                          (field) => (
                            <span key={field.key} className={styles.pill}>
                              {field.label}{' '}
                              <span className="tnum">{num(entry[field.key] as number, 1)}</span>
                              {field.unit === '%' ? '%' : ''}
                            </span>
                          ),
                        )}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </Card>
        </Section>
      ) : null}

      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        title="Log measurements"
        subtitle="Fill in only what you measured. Everything here is optional."
      >
        <MeasurementForm onDone={() => setAdding(false)} />
      </Sheet>

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit measurements"
        subtitle={editing ? formatDay(editing.date) : undefined}
      >
        {editing ? <MeasurementForm entry={editing} onDone={() => setEditing(null)} /> : null}
      </Sheet>
    </>
  )
}
