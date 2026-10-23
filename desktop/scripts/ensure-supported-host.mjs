const supported = process.platform === 'darwin' || process.platform === 'win32'

if (!supported) {
  console.error('DeepDive Desktop development and packaging require macOS or Windows.')
  process.exitCode = 1
}
