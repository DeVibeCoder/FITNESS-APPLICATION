import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import styles from './Button.module.css'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface BaseProps {
  variant?: Variant
  size?: Size
  block?: boolean
  icon?: ReactNode
  children?: ReactNode
  className?: string
}

function classes({ variant = 'primary', size = 'md', block, className }: BaseProps): string {
  return [styles.button, styles[variant], styles[size], block ? styles.block : '', className ?? '']
    .filter(Boolean)
    .join(' ')
}

export function Button({
  variant,
  size,
  block,
  icon,
  children,
  className,
  ...rest
}: BaseProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={classes({ variant, size, block, className })} type="button" {...rest}>
      {icon}
      {children}
    </button>
  )
}

export function ButtonLink({
  to,
  variant,
  size,
  block,
  icon,
  children,
  className,
}: BaseProps & { to: string }) {
  return (
    <Link to={to} className={classes({ variant, size, block, className })}>
      {icon}
      {children}
    </Link>
  )
}
