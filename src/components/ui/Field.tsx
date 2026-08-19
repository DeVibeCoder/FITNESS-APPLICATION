import { useId } from 'react'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import styles from './Field.module.css'

interface FieldProps {
  label: string
  hint?: string
  suffix?: string
  children?: ReactNode
}

export function Field({
  label,
  hint,
  suffix,
  ...rest
}: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.control}>
        <input id={id} className={styles.input} {...rest} />
        {suffix ? <span className={styles.suffix}>{suffix}</span> : null}
      </div>
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  )
}

export function SelectField({
  label,
  hint,
  children,
  ...rest
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId()
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.control}>
        <select id={id} className={styles.select} {...rest}>
          {children}
        </select>
      </div>
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  )
}

interface OptionGroupProps<T extends string | number> {
  label: string
  value: T | undefined
  options: { value: T; label: string; emoji?: string }[]
  onChange: (value: T) => void
  /** Larger targets for emoji scales. */
  variant?: 'pill' | 'emoji'
}

/** A row of chunky, tappable choices — used everywhere a select would feel heavy. */
export function OptionGroup<T extends string | number>({
  label,
  value,
  options,
  onChange,
  variant = 'pill',
}: OptionGroupProps<T>) {
  return (
    <fieldset className={styles.field}>
      <legend className={styles.label}>{label}</legend>
      <div className={variant === 'emoji' ? styles.emojiRow : styles.pillRow}>
        {options.map((option) => {
          const selected = option.value === value
          return (
            <button
              key={String(option.value)}
              type="button"
              className={[
                variant === 'emoji' ? styles.emoji : styles.pill,
                selected ? styles.selected : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
            >
              {option.emoji ? (
                <span className={styles.emojiGlyph} aria-hidden="true">
                  {option.emoji}
                </span>
              ) : null}
              <span className={variant === 'emoji' ? styles.emojiLabel : undefined}>
                {option.label}
              </span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
