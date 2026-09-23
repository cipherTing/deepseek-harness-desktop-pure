import { execFile } from 'node:child_process'
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runtimeFileExclusion } from './runtime-file-policy.mjs'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtime = resolve(desktop, 'src-tauri/rt')
const modules = resolve(runtime, 'node_modules')
// The CLI builds each platform on that platform, so the host is the target.
const target = { platform: process.platform, arch: process.arch }

await rewriteRuntimeManifest()
await omitNonRuntimeFiles()

await validateRuntimeLayout(modules)

const helper = await findFile(modules, 'ensure-spawn-helper.mjs')
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

/**
 * Replace the manifest `pnpm deploy` wrote with one that describes the shipped
 * runtime: the installation's own absolute paths stay out of the artifact, and
 * every dependency keeps its name so profile boot still resolves its closure
 * from this anchor.
 */
async function rewriteRuntimeManifest() {
  const path = join(runtime, 'package.json')
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  const dependencies = {}
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    dependencies[name] = await installedVersion(name) ?? '0.0.0'
  }
  const kept = {}
  for (const key of ['name', 'version', 'private', 'license', 'type', 'repository', 'author', 'exports']) {
    if (manifest[key] !== undefined) kept[key] = manifest[key]
  }
  await writeFile(path, `${JSON.stringify({ ...kept, dependencies }, null, 2)}\n`)
  process.stdout.write(`Desktop runtime manifest lists ${Object.keys(dependencies).length} dependency names.\n`)
}

/** Version of one installed dependency, or undefined when it is not deployed. */
async function installedVersion(name) {
  try {
    const manifest = JSON.parse(await readFile(join(modules, name, 'package.json'), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}

/**
 * Apply {@link runtimeFileExclusion} to the deployed tree and report what left,
 * so a policy that stops matching a dependency bump is visible in the build log.
 */
async function omitNonRuntimeFiles() {
  const omitted = new Map()
  let bytes = 0
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const reason = runtimeFileExclusion(relative(runtime, path), target)
      if (reason !== undefined) {
        bytes += await entryBytes(path)
        omitted.set(reason, (omitted.get(reason) ?? 0) + 1)
        await rm(path, { recursive: true, force: true })
        continue
      }
      if (entry.isDirectory()) await walk(path)
    }
  }
  await walk(runtime)
  const summary = [...omitted].sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => `${reason}: ${count}`)
  process.stdout.write(
    `Desktop runtime omitted ${String([...omitted.values()].reduce((sum, count) => sum + count, 0))} entries `
    + `(${(bytes / 1024 / 1024).toFixed(1)} MiB) — ${summary.join(', ')}.\n`,
  )
}

/** Bytes one entry occupies: a file's size, or a directory's contents. */
async function entryBytes(path) {
  const info = await stat(path)
  if (!info.isDirectory()) return info.size
  let total = 0
  for (const entry of await readdir(path, { withFileTypes: true })) {
    total += await entryBytes(join(path, entry.name))
  }
  return total
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

async function validateRuntimeLayout(directory) {
  const links = await findLinks(directory)
  const packageLinks = links.filter((path) => {
    return !path.replaceAll('\\', '/').includes('/node_modules/.bin/')
  })
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
