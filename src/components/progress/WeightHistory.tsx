import { useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { EmptyState } from '@/components/ui/EmptyState'
import { WeightEntryForm } from './WeightEntryForm'
import type { WeightEntry } from '@/models'
import { withDeltas } from '@/utils/progress'
import { formatDay } from '@/utils/date'
import { num, signed } from '@/utils/format'
import { EMPTY } from '@/data/messages'
import styles from './WeightHistory.module.css'

type Filter = 'all' | 'official' | 'daily'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'official', label: 'Official' },
  { value: 'daily', label: 'Daily' },
]

/**
 * Every weigh-in, newest first. Changes are compared like with like — an
 * official entry against the previous official one — so a daily reading never
 * makes a weekly result look different than it was.
 */
export function WeightHistory({ entries }: { entries: WeightEntry[] }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<WeightEntry | null>(null)
  const [adding, setAdding] = useState(false)

  const rows = withDeltas(entries).filter(
    ({ entry }) => filter === 'all' || entry.kind === filter,
  )

  return (
    <>
      <div className={styles.filters} role="tablist" aria-label="Filter weigh-ins">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            role="tab"
            aria-selected={filter === option.value}
            className={[styles.filter, filter === option.value ? styles.filterActive : '']
              .filter(Boolean)
              .join(' ')}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          compact
          title={entries.length === 0 ? EMPTY.noWeights.title : 'Nothing of that type yet'}
          body={
            entries.length === 0
              ? EMPTY.noWeights.body
              : 'Try another filter, or log one of these.'
          }
          action={
            <Button icon={<Plus size={16} strokeWidth={2.4} />} onClick={() => setAdding(true)}>
              Log weigh-in
            </Button>
          }
        />
      ) : (
        <Card flush>
          <ul className={styles.list}>
            {rows.map(({ entry, changeKg }) => (
              <li key={entry.id}>
                <button className={styles.row} onClick={() => setEditing(entry)}>
                  <span className={styles.date}>{formatDay(entry.date)}</span>
                  <span className={styles.main}>
                    <span className={styles.weight}>
                      <span className="tnum">{num(entry.weightKg, 1)}</span> kg
                    </span>
                    <span
                      className={[
                        styles.kind,
                        entry.kind === 'official' ? styles.official : styles.daily,
                      ].join(' ')}
                    >
                      {entry.kind === 'official' ? 'Official' : 'Daily'}
                    </span>
                    {entry.note ? <span className={styles.note}>{entry.note}</span> : null}
                  </span>
                  <span className={styles.right}>
                    <span
                      className={[
                        styles.change,
                        changeKg === undefined
                          ? styles.flat
                          : changeKg < 0
                            ? styles.down
                            : changeKg > 0
                              ? styles.up
                              : styles.flat,
                      ].join(' ')}
                    >
                      {changeKg === undefined ? '—' : `${signed(changeKg)} kg`}
                    </span>
                    <Pencil size={13} strokeWidth={2} className={styles.pencil} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit weigh-in"
        subtitle="Correct or remove this record."
      >
        {editing ? (
          <WeightEntryForm entry={editing} onDone={() => setEditing(null)} />
        ) : null}
      </Sheet>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Log weigh-in">
        <WeightEntryForm onDone={() => setAdding(false)} />
      </Sheet>
    </>
  )
}
