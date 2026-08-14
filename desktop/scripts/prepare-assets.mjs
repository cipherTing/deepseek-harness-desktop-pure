import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const webSource = resolve(desktop, '../apps/web/dist')
const webTarget = resolve(desktop, 'src-tauri/resources/web')

await rm(webTarget, { recursive: true, force: true })
await mkdir(webTarget, { recursive: true })
await cp(webSource, webTarget, { recursive: true })
await build({
  entryPoints: [resolve(desktop, 'bridge/src/index.ts')],
  outfile: resolve(webTarget, 'desktop-bridge.js'),
  bundle: true,
  platform: 'browser',
  target: ['safari15', 'chrome105'],
  format: 'iife',
  minify: true,
  sourcemap: true,
  logLevel: 'info',
})
