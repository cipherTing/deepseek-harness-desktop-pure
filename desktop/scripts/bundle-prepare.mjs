import { spawnSync } from 'node:child_process'

/**
 * Full desktop bundle preparation, gated for incremental workflows:
 * `DESKTOP_SKIP_BUNDLE=1` turns this into a no-op so `tauri dev`/`tauri build`
 * can skip the full harness rebuild once the artifacts exist (CI builds the
 * bundle once, then reuses it for tests and packaging).
 */

if (process.env.DESKTOP_SKIP_BUNDLE === '1') {
  console.log('bundle:prepare skipped (DESKTOP_SKIP_BUNDLE=1)')
  process.exit(0)
}

const steps = [
  ['pnpm', ['run', 'build:harness']],
  ['pnpm', ['run', 'build:runtime']],
  ['pnpm', ['run', 'prepare:node']],
]

for (const [command, args] of steps) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error !== undefined) {
    console.error(`bundle:prepare failed to launch ${command}: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}
