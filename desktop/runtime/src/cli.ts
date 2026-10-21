/**
 * The `dsh` launcher this installation puts on the user's PATH.
 *
 * The public CLI is packaged inside the application, so a shell script cannot
 * call it directly: the launcher re-enters the packaged `dsh` with the two facts
 * only an installation knows — where the bundled pnpm lives, and that this
 * carrier may manage the profile it owns. Everything else (arguments, exit
 * codes, `--help`, plugin subcommands) is the upstream CLI's own behavior.
 *
 * @module @deepseek-ai/dsh-desktop-runtime/cli
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProfilePnpmInvocation } from '@deepseek-ai/dsh-app-boot'

const runtimeRoot = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * Package-manager invocation for profile plugin operations; the deployed
 * runtime ships pnpm beside the bundled Node, so `dsh plugin` needs no system
 * Node.js or pnpm.
 * @returns the invocation, or `undefined` when the packaged pnpm is absent.
 */
function bundledPackageManager(): ProfilePnpmInvocation | undefined {
  const entry = join(runtimeRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
  if (!existsSync(entry)) return undefined
  return { command: process.execPath, args: [entry], env: {} }
}

/** The `runCli` export of the packaged CLI. */
interface CliEntry {
  runCli(options?: {
    packageManager?: ProfilePnpmInvocation | undefined
    manageDesktopProfile?: boolean
  }): Promise<void>
}

const entry = join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
if (!existsSync(entry)) {
  process.stderr.write(`dsh: the packaged CLI is missing from ${entry}\n`)
  process.exit(1)
}
// A `file:` specifier keeps the packaged path out of any module resolution the
// user's cwd might otherwise influence.
const cli = await import(`file://${entry}`) as CliEntry
await cli.runCli({ manageDesktopProfile: true, packageManager: bundledPackageManager() })
