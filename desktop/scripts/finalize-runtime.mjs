import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const modules = resolve(desktop, 'src-tauri/rt/node_modules')

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
