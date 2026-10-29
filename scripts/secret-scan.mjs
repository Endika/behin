import { execSync } from 'node:child_process'
const PATTERNS = [
  'eyJ[A-Za-z0-9_-]{20,}',
  'sk_(live|test)_[A-Za-z0-9]+',
  'SUPABASE_(URL|ANON_KEY|SERVICE_ROLE_KEY)\\s*=\\s*[\'"]?https?://|SUPABASE_(URL|ANON_KEY|SERVICE_ROLE_KEY)\\s*=\\s*[\'"]?eyJ',
]
let staged
try {
  staged = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' })
    .split('\n').filter(Boolean)
} catch { process.exit(0) }
const EXCLUDE = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']
const files = staged.filter(
  (f) =>
    /\.(ts|tsx|js|jsx|json|env(\.[^.]+)?|ya?ml|md|sh|mjs|cjs)$/.test(f) &&
    !EXCLUDE.some((ex) => f === ex || f.endsWith(`/${ex}`)),
)
if (!files.length) process.exit(0)
const rg = PATTERNS.join('|')
let hit = false
for (const f of files) {
  try {
    const out = execSync(`git show ":${f}"`, { encoding: 'utf8' })
    const re = new RegExp(rg)
    if (re.test(out)) {
      console.error(`Secret-like pattern in staged file: ${f}`)
      hit = true
    }
  } catch {}
}
if (hit) {
  console.error('Aborting commit. Move the secret to .env.local and try again.')
  process.exit(1)
}
