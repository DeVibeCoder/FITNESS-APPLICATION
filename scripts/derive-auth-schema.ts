/**
 * Asks Better Auth what schema it actually wants, given our real config.
 *
 * Phase 6 corrected this schema one failing request at a time, which found a
 * new missing column on each attempt and had no reason to stop. `getAuthTables`
 * is the library's own answer to the same question, so this reads it once
 * instead of guessing repeatedly.
 */
import { getAuthTables } from 'better-auth'
import { createAuth } from '../server/auth/auth'

const fakeD1 = { prepare: () => ({ bind: () => ({ first: async () => null }) }) }
const auth = createAuth({
  DB: fakeD1,
  AUTH_SECRET: 'a'.repeat(32),
  ENVIRONMENT: 'development',
  BASE_URL: 'http://127.0.0.1:8793',
})

const tables = getAuthTables((auth as unknown as { options: Record<string, unknown> }).options)

for (const [model, table] of Object.entries(tables)) {
  const t = table as { modelName: string; fields: Record<string, Record<string, unknown>> }
  console.log(`\n=== model "${model}" -> table "${t.modelName}" ===`)
  for (const [field, spec] of Object.entries(t.fields)) {
    const s = spec as {
      type?: unknown
      required?: boolean
      unique?: boolean
      fieldName?: string
      defaultValue?: unknown
      references?: { model?: string; field?: string; onDelete?: string }
    }
    const column = s.fieldName ?? field
    const bits = [
      `type=${JSON.stringify(s.type)}`,
      s.required ? 'required' : 'nullable',
      s.unique ? 'UNIQUE' : '',
      s.references ? `-> ${s.references.model}.${s.references.field} (${s.references.onDelete ?? 'none'})` : '',
      s.defaultValue !== undefined ? 'hasDefault' : '',
    ].filter(Boolean)
    console.log(`  ${field.padEnd(24)} column=${column.padEnd(26)} ${bits.join(' ')}`)
  }
}
