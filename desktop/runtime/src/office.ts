/**
 * The official Office skills over this runtime's bundled LibreOffice Kit.
 *
 * The `web` profile deliberately leaves Office authoring composition to its
 * carrier, so Desktop mounts it here. The skills receive absolute paths: this
 * deploy carries the skill assets beside the runtime packages and the engine
 * CLI inside them, and the sidecar itself is the Node that executes it.
 * @module @deepseek-ai/dsh-desktop-runtime/office
 */

import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import * as officeSkills from '@deepseek-ai/dsh-skill-office'

/** Cordis plugin identity. */
export const name = 'desktop-office'

/**
 * Assert that one bundled Office resource is deployed, so a runtime missing
 * part of the payload fails at Loader activation rather than on the first
 * Office skill invocation.
 * @param path - absolute path the skills receive.
 * @param kind - expected entry kind.
 * @returns the same path.
 * @throws {Error} when the entry is absent or of the other kind.
 */
function deployed(path: string, kind: 'file' | 'directory'): string {
  const stats = statSync(path, { throwIfNoEntry: false })
  const matches = kind === 'file' ? stats?.isFile() : stats?.isDirectory()
  if (matches !== true) throw new Error(`desktop-office: the runtime must deploy the Office ${kind} ${path}`)
  return path
}

/**
 * Register the Office skills against the bundled engine.
 * @param ctx - Profile scope; the provider lands in the host-plane skill registry every preset reads.
 */
export async function apply(ctx: Context): Promise<void> {
  const packages = join(dirname(dirname(fileURLToPath(import.meta.url))), 'node_modules', '@deepseek-ai')
  await ctx.plugin(officeSkills, {
    assetRoot: deployed(join(packages, 'dsh-skill-office', 'assets'), 'directory'),
    node: deployed(process.execPath, 'file'),
    cli: deployed(join(packages, 'libreoffice-kit', 'lib', 'cli.js'), 'file'),
  })
}
