import { execFile } from 'node:child_process'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(desktop, '..')
const runtime = resolve(desktop, 'runtime')
const outdir = resolve(runtime, 'lib')
const config = resolve(runtime, 'config')
const deploy = resolve(desktop, 'src-tauri/resources/runtime')

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

await rm(deploy, { recursive: true, force: true })
await new Promise((resolvePromise, reject) => {
  execFile('pnpm', [
    '--config.inject-workspace-packages=true',
    '--config.node-linker=hoisted',
    '--config.strict-dep-builds=false',
    '--filter', '@deepseek-ai/dsh-desktop-runtime',
    'deploy', '--prod', deploy,
  ], { cwd: root }, (error, stdout, stderr) => {
    process.stdout.write(stdout)
    process.stderr.write(stderr)
    if (error === null) resolvePromise()
    else reject(error)
  })
})

await validateRuntimeLayout(resolve(deploy, 'node_modules'))

const helper = await findFile(resolve(deploy, 'node_modules'), 'ensure-spawn-helper.mjs')
if (helper !== undefined) {
  await new Promise((resolvePromise, reject) => {
    execFile(process.execPath, [helper], { cwd: dirname(helper) }, (error, stdout, stderr) => {
      process.stdout.write(stdout)
      process.stderr.write(stderr)
      if (error === null) resolvePromise()
      else reject(error)
    })
  })
}

async function findFile(directory, name) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isFile() && entry.name === name) return path
    if (entry.isDirectory()) {
      const nested = await findFile(path, name)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

async function validateRuntimeLayout(modules) {
  const links = await findLinks(modules)
  const packageLinks = links.filter(path => !path.includes('/node_modules/.bin/'))
  if (packageLinks.length > 0) {
    throw new Error(`desktop runtime contains package symlinks:\n${packageLinks.join('\n')}`)
  }
  process.stdout.write(`Desktop runtime uses a hoisted package tree (${links.length} executable links).\n`)
}

async function findLinks(directory) {
  const links = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isSymbolicLink()) {
      links.push(path)
    } else if (entry.isDirectory()) {
      links.push(...await findLinks(path))
    }
  }
  return links
}

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
