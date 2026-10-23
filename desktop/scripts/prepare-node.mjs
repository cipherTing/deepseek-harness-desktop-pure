import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const NODE_VERSION = '22.23.2'
const TARGETS = {
  'aarch64-apple-darwin': {
    archive: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
    checksum: '61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6',
    binary: `node-v${NODE_VERSION}-darwin-arm64/bin/node`,
    output: 'node-aarch64-apple-darwin',
  },
  'x86_64-pc-windows-msvc': {
    archive: `node-v${NODE_VERSION}-win-x64.zip`,
    checksum: '1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97',
    binary: `node-v${NODE_VERSION}-win-x64/node.exe`,
    output: 'node-x86_64-pc-windows-msvc.exe',
  },
}

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(desktop, '..')
const triple = process.env.TAURI_ENV_TARGET_TRIPLE ?? await hostTriple()
const target = TARGETS[triple]
if (target === undefined) throw new Error(`Unsupported Desktop target ${triple}`)

const cache = resolve(root, '.cache/desktop-node', NODE_VERSION)
const archive = resolve(cache, target.archive)
const extracted = resolve(cache, `${triple}-extracted`)
const outputDir = resolve(desktop, 'src-tauri/binaries')
const output = resolve(outputDir, target.output)
await mkdir(cache, { recursive: true })
await mkdir(outputDir, { recursive: true })

let bytes
try {
  bytes = await readFile(archive)
} catch {
  const response = await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/${target.archive}`)
  if (!response.ok) throw new Error(`Node download failed: HTTP ${response.status}`)
  bytes = Buffer.from(await response.arrayBuffer())
  await writeFile(archive, bytes)
}
const checksum = createHash('sha256').update(bytes).digest('hex')
if (checksum !== target.checksum) throw new Error(`Node checksum mismatch for ${target.archive}`)

await rm(extracted, { recursive: true, force: true })
await mkdir(extracted, { recursive: true })
await exec('tar', ['-xf', archive, '-C', extracted])
await cp(resolve(extracted, target.binary), output)
if (!triple.includes('windows')) await chmod(output, 0o755)

async function hostTriple() {
  const output = await exec('rustc', ['-vV'])
  const match = /^host: (.+)$/m.exec(output)
  if (match === null) throw new Error('rustc did not report a host triple')
  return match[1]
}

function exec(command, args) {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error === null) resolvePromise(stdout)
      else reject(new Error(`${command} failed: ${stderr || error.message}`))
    })
  })
}
