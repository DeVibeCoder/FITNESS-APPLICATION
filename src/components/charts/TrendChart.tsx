import { useId, useMemo } from 'react'
import { useElementWidth } from '@/hooks/useElementWidth'
import { formatDay } from '@/utils/date'
import { num } from '@/utils/format'
import styles from './TrendChart.module.css'

export interface TrendPoint {
  date: string
  value: number
}

interface TrendChartProps {
  points: TrendPoint[]
  height?: number
  /** Draws a dashed line at the goal, e.g. target weight. */
  goal?: number
  unit?: string
  digits?: number
}

/**
 * One line, one goal marker, two end labels. No gridlines, no legend, no
 * tooltip — this is a shape you glance at, not a report you study.
 */
export function TrendChart({ points, height = 132, goal, unit = 'kg', digits = 1 }: TrendChartProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  // Unique per instance so two charts on one page cannot share a gradient.
  const fillId = `trend-fill-${useId().replace(/:/g, '')}`

  const geometry = useMemo(() => {
    if (points.length < 2 || width < 40) return null
    const padX = 4
    const padTop = 16
    const padBottom = 22

    const values = points.map((p) => p.value)
    const candidates = goal === undefined ? values : [...values, goal]
    const rawMin = Math.min(...candidates)
    const rawMax = Math.max(...candidates)
    // A little headroom so the line never touches the edges.
    const span = Math.max(rawMax - rawMin, 0.6)
    const min = rawMin - span * 0.18
    const max = rawMax + span * 0.18

    const innerW = width - padX * 2
    const innerH = height - padTop - padBottom
    const x = (i: number) => padX + (i / (points.length - 1)) * innerW
    const y = (value: number) => padTop + (1 - (value - min) / (max - min)) * innerH

    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
    const area = `${line} L${x(points.length - 1).toFixed(1)},${(height - padBottom).toFixed(1)} L${x(0).toFixed(1)},${(height - padBottom).toFixed(1)} Z`

    return {
      line,
      area,
      lastX: x(points.length - 1),
      lastY: y(points[points.length - 1].value),
      firstX: x(0),
      firstY: y(points[0].value),
      goalY: goal === undefined ? null : y(goal),
      baseline: height - padBottom,
    }
  }, [points, width, height, goal])

  const first = points[0]
  const last = points[points.length - 1]

  return (
    <div className={styles.chart} ref={ref}>
      {geometry ? (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Trend from ${num(first.value, digits)} ${unit} on ${formatDay(first.date)} to ${num(last.value, digits)} ${unit} on ${formatDay(last.date)}`}
        >
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {geometry.goalY !== null ? (
            <>
              <line
                x1={0}
                x2={width}
                y1={geometry.goalY}
                y2={geometry.goalY}
                stroke="var(--success)"
                strokeWidth="1.5"
                strokeDasharray="3 5"
                opacity="0.7"
              />
              <text
                x={width - 2}
                y={geometry.goalY - 6}
                textAnchor="end"
                className={styles.goalLabel}
              >
                Goal
              </text>
            </>
          ) : null}

          <path d={geometry.area} fill={`url(#${fillId})`} />
          <path
            className={styles.line}
            d={geometry.line}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx={geometry.firstX} cy={geometry.firstY} r="3" fill="var(--surface)" stroke="var(--accent)" strokeWidth="2" />
          <circle cx={geometry.lastX} cy={geometry.lastY} r="4.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2.5" />

          <text x={2} y={height - 6} className={styles.axis}>
            {formatDay(first.date)}
          </text>
          <text x={width - 2} y={height - 6} textAnchor="end" className={styles.axis}>
            {formatDay(last.date)}
          </text>
        </svg>
      ) : (
        <div style={{ height }} />
      )}
    </div>
  )
}
