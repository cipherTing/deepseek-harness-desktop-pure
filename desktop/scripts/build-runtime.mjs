import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(desktop, '..')
const runtime = resolve(desktop, 'runtime')
const outdir = resolve(runtime, 'lib')
const config = resolve(runtime, 'config')
const deployDir = resolve(desktop, 'src-tauri/resources/runtime')

await rm(outdir, { recursive: true, force: true })
await rm(config, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })
await cp(resolve(root, 'apps/cli/config'), config, { recursive: true })
await writeProfileBootBridge()

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  external: ['@deepseek-ai/*'],
  sourcemap: true,
  logLevel: 'info',
}

await build({
  ...common,
  entryPoints: {
    sidecar: resolve(runtime, 'src/sidecar.ts'),
    webserver: resolve(runtime, 'src/webserver.ts'),
    surface: resolve(runtime, 'src/surface.ts'),
    'directory-picker': resolve(runtime, 'src/directory-picker.ts'),
    'api-gateway': resolve(runtime, 'src/api-gateway.ts'),
  },
  outdir,
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
  outExtension: { '.js': '.mjs' },
  splitting: true,
})

await rm(deployDir, { recursive: true, force: true })

async function writeProfileBootBridge() {
  const cliLib = resolve(root, 'apps/cli/lib')
  const candidates = (await readdir(cliLib))
    .filter(name => /^profile-boot-.+\.js$/.test(name))
  const facades = []
  for (const name of candidates) {
    const source = await readFile(resolve(cliLib, name), 'utf8')
    if (/export\s*\{\s*runProfile\s*\}/.test(source)) facades.push(name)
  }
  if (facades.length !== 1) {
    throw new Error(`expected one built dsh profile-boot facade, found ${facades.length}`)
  }
  const specifier = `../node_modules/@deepseek-ai/dsh/lib/${facades[0]}`
  await writeFile(resolve(outdir, 'profile-boot.mjs'), `export { runProfile } from ${JSON.stringify(specifier)}\n`)
}
