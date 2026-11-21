// Compiles build/launcher.cs into build/launcher.exe with the .NET Framework
// compiler that ships with Windows. The launcher is copied into the packaged
// app by build/after-pack.cjs.
const { spawnSync } = require('node:child_process')
const { existsSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const buildDir = join(root, 'build')
const source = join(buildDir, 'launcher.cs')
const icon = join(buildDir, 'icon.ico')
const output = join(buildDir, 'launcher.exe')

const cscCandidates = [
  join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
]

const csc = cscCandidates.find((candidate) => existsSync(candidate))
if (!csc) {
  console.error('Could not find the .NET Framework C# compiler (csc.exe).')
  console.error('Install .NET Framework 4.x, or remove the launcher from electron-builder.yml.')
  process.exit(1)
}

mkdirSync(buildDir, { recursive: true })

const args = [
  '/nologo',
  '/target:winexe',
  '/optimize+',
  '/platform:anycpu',
  `/win32icon:${icon}`,
  `/out:${output}`,
  source
]

const result = spawnSync(csc, args, { stdio: 'inherit' })
if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

console.log(`Built ${output}`)
