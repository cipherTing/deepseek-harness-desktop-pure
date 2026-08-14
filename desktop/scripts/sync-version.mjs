import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagePath = resolve(desktopDir, 'package.json')
const runtimePackagePath = resolve(desktopDir, 'runtime/package.json')
const cargoPath = resolve(desktopDir, 'src-tauri/Cargo.toml')
const cargoLockPath = resolve(desktopDir, 'src-tauri/Cargo.lock')
const argumentsList = process.argv.slice(2).filter((argument) => argument !== '--')
const setIndex = argumentsList.indexOf('--set')
const requestedVersion = setIndex === -1 ? undefined : argumentsList[setIndex + 1]
const checkOnly = argumentsList.includes('--check')

if (checkOnly && setIndex !== -1) throw new Error('Choose either --check or --set <version>')
if (setIndex !== -1 && requestedVersion === undefined) throw new Error('Usage: --set <version>')
if (argumentsList.some((argument, index) => {
  if (argument === '--check') return false
  if (argument === '--set') return false
  if (setIndex !== -1 && index === setIndex + 1) return false
  return true
})) {
  throw new Error('Usage: node ./scripts/sync-version.mjs [--check | --set <version>]')
}

const desktopPackage = JSON.parse(await readFile(packagePath, 'utf8'))
const version = requestedVersion ?? desktopPackage.version
if (!isSemver(version)) throw new Error(`Invalid Desktop SemVer: ${version}`)

const runtimePackage = JSON.parse(await readFile(runtimePackagePath, 'utf8'))
const cargo = await readFile(cargoPath, 'utf8')
const cargoLock = await readFile(cargoLockPath, 'utf8')
const expectedRuntimePackage = { ...runtimePackage, version }
const expectedCargo = replaceCargoVersion(cargo, version)
const expectedCargoLock = replaceCargoLockVersion(cargoLock, version)

const mirrors = [
  [runtimePackagePath, JSON.stringify(expectedRuntimePackage, null, 2) + '\n', JSON.stringify(runtimePackage, null, 2) + '\n'],
  [cargoPath, expectedCargo, cargo],
  [cargoLockPath, expectedCargoLock, cargoLock],
]

if (checkOnly) {
  const mismatches = mirrors.filter(([, expected, current]) => expected !== current).map(([path]) => path)
  if (mismatches.length > 0) throw new Error(`Desktop version mirrors are out of sync:\n${mismatches.join('\n')}`)
  process.stdout.write(`Desktop version ${version} is synchronized.\n`)
} else {
  if (requestedVersion !== undefined) {
    desktopPackage.version = version
    await writeFile(packagePath, JSON.stringify(desktopPackage, null, 2) + '\n')
  }
  for (const [path, expected, current] of mirrors) {
    if (expected !== current) await writeFile(path, expected)
  }
  process.stdout.write(`Desktop version synchronized to ${version}.\n`)
}

function isSemver(value) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value)
}

function replaceCargoVersion(source, nextVersion) {
  const pattern = /^(version = ")([^"]+)(")$/m
  if (!pattern.test(source)) throw new Error(`Missing Rust package version in ${cargoPath}`)
  return source.replace(pattern, `$1${nextVersion}$3`)
}

function replaceCargoLockVersion(source, nextVersion) {
  const pattern = /(\[\[package\]\]\nname = "deepseek-harness-desktop"\nversion = ")([^"]+)(")/m
  if (!pattern.test(source)) throw new Error(`Missing Rust lockfile package version in ${cargoLockPath}`)
  return source.replace(pattern, `$1${nextVersion}$3`)
}
