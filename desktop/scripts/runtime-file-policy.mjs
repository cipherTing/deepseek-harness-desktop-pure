/**
 * Files the immutable Desktop runtime omits from the tree `pnpm deploy`
 * produced. Every runtime asset the Harness loads stays; only build outputs,
 * type declarations, package-manager state, and native payloads for another
 * platform are omitted, so the shipped artifact carries what it runs.
 *
 * Upstream's Electron package set applies the same kind of policy before it
 * seals its runtime; the rules here name this fork's deployed layout, whose
 * paths are relative to the deploy root (`rt/`) rather than to a copied
 * `node_modules` container.
 * @module desktop/scripts/runtime-file-policy
 */

/**
 * @typedef {object} RuntimeTarget
 * @property {string} platform `process.platform` value of the packaged platform.
 * @property {string} arch `process.arch` value of the packaged platform.
 */

/** Path segments that only describe how the tree was installed. */
const PACKAGE_MANAGER_SEGMENTS = new Set([
  '.bin',
  '.pnpm',
  '.modules.yaml',
  '.pnpm-workspace-state-v1.json',
])

/** Whole-file names at the deploy root that only describe the installation. */
const PACKAGE_MANAGER_FILES = new Set(['pnpm-lock.yaml', 'pnpm-workspace.yaml'])

/**
 * Decide whether one deployed entry is omitted.
 * @param {string} path Path relative to the deploy root, with either separator.
 * @param {RuntimeTarget} target Platform and architecture the runtime runs on.
 * @returns {string | undefined} the omission reason, or `undefined` when the entry must ship.
 */
export function runtimeFileExclusion(path, target) {
  const segments = path.split(/[\\/]/u)
  const file = segments.at(-1) ?? ''
  if (PACKAGE_MANAGER_FILES.has(file) && segments.length === 1) return 'package-manager state'
  if (segments.some(segment => PACKAGE_MANAGER_SEGMENTS.has(segment))) return 'package-manager state'
  if (/\.(?:[cm]?[jt]s|css)\.map$/u.test(file)) return 'source map'
  if (/\.d\.[cm]?ts$/u.test(file)) return 'type declaration'
  if (/\.tsbuildinfo$/u.test(file)) return 'TypeScript build cache'

  const modules = segments.lastIndexOf('node_modules')
  if (modules === -1) return undefined
  const packageParts = segments.slice(modules + 1)
  const nameParts = packageParts[0]?.startsWith('@') ? 2 : 1
  const name = packageParts.slice(0, nameParts).join('/')
  const entry = packageParts.slice(nameParts).join('/')

  if (name === 'node-pty' && entry.startsWith('prebuilds/')) {
    const platform = packageParts[nameParts + 1]
    if (platform !== undefined && platform !== `${target.platform}-${target.arch}`) {
      return 'node-pty other platform'
    }
    if (file.endsWith('.pdb')) return 'node-pty debug symbols'
  }
  if (name.startsWith('@deepseek-ai/libreoffice-kit-')) {
    const engine = name.slice('@deepseek-ai/libreoffice-kit-'.length)
    if (engine !== `${target.platform}-${target.arch}`) return 'LibreOffice other platform'
  }
  if (name === '@mixmark-io/domino' && (entry === 'test' || entry.startsWith('test/'))) {
    return 'Domino test fixtures'
  }
  return undefined
}
