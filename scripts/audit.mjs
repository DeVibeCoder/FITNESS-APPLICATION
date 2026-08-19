/**
 * Static audit for the final polish pass.
 *
 * Mechanical checks only — dead files, unused CSS, unlabelled icon buttons,
 * overflow risks, terminology drift. Nothing here replaces looking at the app;
 * it just finds the things a person should not have to hunt for.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname, basename } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const files = walk(ROOT)
const code = files.filter((f) => ['.ts', '.tsx'].includes(extname(f)))
const css = files.filter((f) => f.endsWith('.module.css'))
const read = (f) => readFileSync(f, 'utf8')
const rel = (f) => relative(ROOT, f).replace(/\\/g, '/')

const allSource = code.map((f) => ({ path: f, text: read(f) }))
const joined = allSource.map((f) => f.text).join('\n')

const section = (title) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`)
const report = (rows, cleanMessage) => {
  if (rows.length === 0) console.log(`   ${cleanMessage}`)
  else rows.forEach((r) => console.log(`   ${r}`))
}

// --- 1. Files nothing imports ---------------------------------------------
section('Unreferenced source files')
const entryPoints = ['main.tsx', 'App.tsx', 'vite.config.ts', 'food-scan.ts', 'verify-data.ts', 'audit.mjs', 'generate-icons.mjs']
const orphans = []
for (const { path } of allSource) {
  const name = basename(path).replace(/\.(ts|tsx)$/, '')
  if (entryPoints.includes(basename(path))) continue
  if (name === 'index') continue // Barrel, imported as its directory.
  // Imported by module path, with or without an explicit file extension —
  // the server modules spell theirs out so Vite stops warning about them.
  const pattern = new RegExp('[\'"`][^\'"`]*/' + name + '(\\.tsx?|\\.js)?[\'"`]')
  const referenced = allSource.some((other) => other.path !== path && pattern.test(other.text))
  if (!referenced) orphans.push(rel(path))
}
report(orphans, 'every file is imported somewhere')

// --- 2. CSS module classes with no matching usage -------------------------
section('Unused CSS module classes')
const deadClasses = []
for (const sheet of css) {
  // A stylesheet can be imported by more than one component — MeasurementForm
  // shares WeightEntryForm's sheet. Checking only the same-named .tsx once led
  // to a live class being deleted, so every importer is consulted.
  const sheetName = basename(sheet)
  const importers = allSource.filter((f) => f.text.includes(sheetName))
  if (importers.length === 0) {
    deadClasses.push(`${rel(sheet)} - imported by nothing`)
    continue
  }
  const combined = importers.map((f) => f.text).join(String.fromCharCode(10))
  const dynamic = /styles\[[^'"`\]]/.test(combined)
  const classNames = [...read(sheet).matchAll(/^\.([a-zA-Z][\w-]*)/gm)].map((m) => m[1])
  const unused = dynamic
    ? []
    : [...new Set(classNames)].filter(
        (name) => !new RegExp('styles\\.' + name + '\\b').test(combined) && !combined.includes('styles[' + JSON.stringify(name)),
      )
  if (unused.length) deadClasses.push(`${rel(sheet)}: ${unused.join(', ')}`)
}

report(deadClasses, 'no unused classes found')

// --- 3. Routes declared vs linked -----------------------------------------
section('Routes')
const app = read(join(ROOT, 'src/App.tsx'))

/**
 * Resolves every <Route> to the URL it actually answers on.
 *
 * A child of a layout route declares a *relative* path — `awards` inside
 * `group` serves /group/awards — so matching the raw attribute would report
 * two perfectly reachable Group tabs as orphans. This walks the tags in order,
 * keeping a stack of enclosing prefixes, and returns full paths.
 */
function resolveRoutes(source) {
  const found = []
  const stack = []
  const tag = /<Route\b|<\/Route>/g
  let match

  while ((match = tag.exec(source)) !== null) {
    if (match[0] === '</Route>') {
      stack.pop()
      continue
    }
    // Read to the end of the opening tag, tracking brace depth so a `>` inside
    // an element={...} expression does not end it early.
    let depth = 0
    let index = tag.lastIndex
    for (; index < source.length; index += 1) {
      const char = source[index]
      if (char === '{') depth += 1
      else if (char === '}') depth -= 1
      else if (char === '>' && depth === 0) break
    }
    const attrs = source.slice(match.index, index)
    const selfClosing = source[index - 1] === '/'
    const path = /\bpath="([^"]+)"/.exec(attrs)?.[1] ?? ''
    const parent = stack.length ? stack[stack.length - 1] : ''
    const full = path.startsWith('/')
      ? path
      : path
        ? `${parent}/${path}`.replace(/\/+/g, '/')
        : parent

    if (path && path !== '*') {
      found.push({ full, redirect: /element=\{<Navigate/.test(attrs) })
    }
    if (!selfClosing) stack.push(full)
    tag.lastIndex = index
  }
  return found
}

const declared = resolveRoutes(app)
const routes = declared.map((r) => r.full)

/**
 * Paths that only exist to forward an old URL somewhere new. Nothing in the
 * app links to them on purpose — a bookmark or an installed PWA shortcut does
 * — so "unlinked" is the correct state rather than a finding.
 */
const redirects = declared.filter((r) => r.redirect).map((r) => r.full)

const unlinked = routes.filter((route) => {
  if (route.includes(":")) return false
  if (redirects.includes(route)) return false
  const target = route.startsWith("/") ? route : "/" + route
  // A destination counts as linked whether it appears as a JSX attribute,
  // a navigate() call, or an entry in a nav config object.
  return ![
    'to="' + target + '"',
    "to='" + target + "'",
    'navigate("' + target,
    "navigate('" + target,
    "to: '" + target + "'",
    'to: "' + target + '"',
  ].some((needle) => joined.includes(needle))
})
console.log(`   ${routes.length} routes declared: ${routes.join(', ')}`)
report(unlinked.map((r) => `not linked from anywhere: ${r}`), 'every route is reachable by a link')

// --- 4. Icon-only buttons without an accessible name ----------------------
section('Icon-only buttons missing an accessible name')
const unlabelled = []

/**
 * The attribute list of a JSX tag starting at `from`.
 *
 * A regex cannot do this: `onClick={() => setOpen((v) => !v)}` contains two
 * `>` characters that are not the end of the tag. So the scan tracks brace
 * depth and only accepts a `>` at depth zero. The previous version used
 * `[^>]*`, matched almost nothing, and its condition was a stray copy of the
 * error-leakage regex — it reported a button that has carried an aria-label
 * all along.
 */
function tagAttributes(text, from) {
  let depth = 0
  for (let i = from; i < text.length; i++) {
    const char = text[i]
    if (char === '{') depth++
    else if (char === '}') depth--
    else if (char === '>' && depth === 0) {
      return { attrs: text.slice(from, i), end: i + 1, selfClosing: text[i - 1] === '/' }
    }
  }
  return null
}

for (const { path, text } of allSource) {
  if (!path.endsWith('.tsx')) continue

  for (const match of text.matchAll(/<button\b/g)) {
    const tag = tagAttributes(text, match.index + '<button'.length)
    if (!tag || tag.selfClosing) continue

    const close = text.indexOf('</button>', tag.end)
    if (close < 0) continue
    const children = text.slice(tag.end, close)

    /*
     * Only genuinely icon-only buttons matter: children that are nothing but
     * self-closing components. A `{option.label}` renders words at runtime
     * even though the source shows no literal text, so treating expressions
     * as "no name" flagged two dozen perfectly good buttons.
     */
    const iconOnly = /^\s*(<[A-Z][\w.]*\b[^>]*\/>\s*)+$/.test(children)
    const labelled = /aria-label(?:ledby)?[=\s]/.test(tag.attrs)

    if (iconOnly && !labelled) {
      unlabelled.push(`${rel(path)}: ${text.slice(match.index, match.index + 70).replace(/\s+/g, ' ')}…`)
    }
  }
}
report(unlabelled, 'all icon-only buttons are labelled')

// --- 5. Overflow risk at 320px --------------------------------------------
section('Fixed widths that could overflow a 320px screen')
const wide = []
for (const sheet of [...css, join(ROOT, 'src/styles/base.css'), join(ROOT, 'src/styles/tokens.css')]) {
  const text = read(sheet)
  for (const match of text.matchAll(/(?:^|[^-])(min-width|width):\s*(\d+(?:\.\d+)?)(px|rem)\s*;/gm)) {
    const [, prop, value, unit] = match
    const px = unit === 'rem' ? Number(value) * 16 : Number(value)
    // 320 minus two 18px gutters and a little card padding.
    if (px > 270 && !text.slice(Math.max(0, match.index - 200), match.index).includes('@media')) {
      wide.push(`${rel(sheet)}: ${prop}: ${value}${unit} (${px}px)`)
    }
  }
}
report(wide, 'no unguarded fixed width exceeds a 320px viewport')

// --- 6. Terminology drift --------------------------------------------------
section('Terminology')
const terms = {
  'weigh-in vs weight entry': [/weigh-in/gi, /weight entry/gi, /add weight/gi],
  'workout vs session vs training': [/\bworkout\b/gi, /\bsession\b/gi, /\btraining\b/gi],
  'delete vs remove': [/>\s*Delete\b/g, /># *Remove\b/g, />\s*Remove\b/g],
}
for (const [label, patterns] of Object.entries(terms)) {
  const counts = patterns.map((p) => (joined.match(p) ?? []).length)
  console.log(`   ${label}: ${counts.join(' / ')}`)
}

/**
 * Findings a person has read and judged safe. Keeping them listed — rather
 * than loosening the check — means the exception stays visible and has to be
 * re-justified if the surrounding code changes.
 */
const REVIEWED_EXCEPTIONS = [
  // Guarded by `error.name === 'OwnershipError'` two lines above; those
  // messages are written by us, for the user ("You can only change your own
  // entries."), not provider text.
  'src/context/ToastContext.tsx',
]

// --- 7. Raw error leakage --------------------------------------------------
section('Possible raw error leakage to the user')
const leaks = []
for (const { path, text } of allSource) {
  if (!path.endsWith('.tsx')) continue
  for (const match of text.matchAll(/show\(([^)]*error[^)]*)\)/gi)) {
    if (/\.message|String\(error\)|\$\{error/.test(match[1]) && !/instanceof|error.names*===/.test(match[1])) {
      leaks.push(`${rel(path)}: ${match[0].slice(0, 80)}`)
    }
  }
}
report(leaks.filter((l) => !REVIEWED_EXCEPTIONS.some((e) => l.startsWith(e))), 'no unguarded error text reaches the UI')

// --- 8. Touch target sizes -------------------------------------------------
section('Interactive elements under 32px')
const small = []

/**
 * Is this class actually applied to something you can press?
 *
 * The name alone is not enough: `actionBadge` is a count rendered inside a
 * link, and inflating it to 32px would make the badge wrong without making
 * anything easier to hit. So the check looks at the JSX and only counts a
 * class that lands on a `<button>` or a link.
 */
function isPressable(className, importers) {
  const pattern = new RegExp(
    `<(?:button|a|Link|NavLink|ButtonLink)\\b[^>]{0,400}styles\\.${className}\\b`,
    's',
  )
  return importers.some((file) => pattern.test(file.text))
}

for (const sheet of css) {
  const text = read(sheet)
  const sheetName = basename(sheet)
  const importers = allSource.filter((f) => f.text.includes(sheetName))

  for (const match of text.matchAll(/(min-height|height):\s*(\d+(?:\.\d+)?)(px|rem)\s*;/g)) {
    const [, , value, unit] = match
    const px = unit === 'rem' ? Number(value) * 16 : Number(value)
    if (px <= 0 || px >= 32) continue

    // The selector this declaration belongs to.
    const before = text.slice(0, match.index)
    const selector = before.match(/([.#][\w-][^{}]*)\{[^{}]*$/)?.[1] ?? ''
    /*
     * A ::before or ::after inside a control is decoration, not the control.
     * The 3px dot marking today on the history calendar is not a tap target,
     * and padding it to 32px would only break the calendar.
     */
    if (/::(before|after)/.test(selector)) continue

    const className = selector.match(/\.([\w-]+)/)?.[1]
    if (!className || !isPressable(className, importers)) continue

    small.push(`${rel(sheet)}: .${className} ${value}${unit} (${px}px)`)
  }
}
report(small, 'no interactive element is under 32px')

// --- 9. Information architecture -------------------------------------------
/*
 * The structural rules this phase established, checked statically so they
 * cannot be undone by accident. Every one of these was a real problem before:
 * Chat buried inside Group, Progress buried inside Activity, and a strip of
 * shortcuts on Home duplicating the bottom bar.
 */
section('Information architecture')
const ia = []

const navSource = read(join(ROOT, 'src/components/nav/BottomNav.tsx'))
const navLabels = [...navSource.matchAll(/label:\s*'([^']+)'/g)].map((m) => m[1])
const EXPECTED_NAV = ['Home', 'Activity', 'Group', 'Chat', 'Progress', 'Me']
if (navLabels.join(',') !== EXPECTED_NAV.join(',')) {
  ia.push(`bottom nav is [${navLabels.join(', ')}], expected [${EXPECTED_NAV.join(', ')}]`)
}
// Create is an action rather than a destination, so it is not in NAV_ITEMS —
// but it must still be rendered, in the middle, as its own raised slot.
if (!/logSlot/.test(navSource) || !/aria-label="Create"/.test(navSource)) {
  ia.push('the Create slot is missing from the bottom bar')
}
const columns = /grid-template-columns:\s*repeat\((\d+),\s*minmax\(0/.exec(
  read(join(ROOT, 'src/components/nav/BottomNav.module.css')),
)
if (columns?.[1] !== '7') {
  ia.push(`the bar is laid out in ${columns?.[1] ?? '?'} columns, expected 7`)
}
if (!/max-width:\s*100vw/.test(read(join(ROOT, 'src/components/nav/BottomNav.module.css')))) {
  ia.push('the fixed nav is not capped at the viewport — it can widen the document')
}

// Desktop has no bottom bar, so the top bar has to offer the same destinations.
const topSource = read(join(ROOT, 'src/components/nav/TopBar.tsx'))
for (const target of ['/chat', '/progress', '/group', '/activity']) {
  if (!topSource.includes(`to: '${target}'`)) {
    ia.push(`${target} is unreachable on desktop — not in the top bar`)
  }
}

// Group is a community dashboard; Chat is a destination. Neither absorbs the other.
const groupTabs = read(join(ROOT, 'src/components/group/GroupTabs.tsx'))
if (/\/chat/.test(groupTabs)) ia.push('Chat is still a tab inside Group')
const groupOverview = read(join(ROOT, 'src/pages/GroupOverview.tsx'))
if (/to="\/chat/.test(groupOverview)) ia.push('the Group overview still links into the chat')

// Home is the feed and nothing else below it.
const home = read(join(ROOT, 'src/pages/Home.tsx'))
if (/GroupSnapshot/.test(home)) ia.push('the Home shortcut strip is back')

// Unread chat belongs to one place only.
for (const { file, label } of [
  { file: 'src/components/nav/TopBar.tsx', label: 'the notification bell' },
  { file: 'src/components/group/GroupHeader.tsx', label: 'the Group header' },
]) {
  if (/chatService\.summary/.test(read(join(ROOT, file))) && label === 'the notification bell') {
    ia.push(`${label} is showing chat unread count`)
  }
}

report(ia, 'navigation, Group/Chat separation and Home all match the agreed structure')

// --- 10. Bundle ------------------------------------------------------------
section('Build output')
try {
  const assets = readdirSync(join(ROOT, 'dist/assets'))
  for (const asset of assets) {
    const size = statSync(join(ROOT, 'dist/assets', asset)).size
    console.log(`   ${asset}  ${(size / 1024).toFixed(1)} kB`)
  }
} catch {
  console.log('   dist/ not built yet')
}

console.log('')
