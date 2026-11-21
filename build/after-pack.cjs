// Replaces the packaged Electron executable with the launcher from
// build/launcher.exe and renames the real executable to "<product> Core.exe".
// The launcher retries with --no-sandbox on machines where Chromium's sandbox
// cannot start.
const { copyFileSync, existsSync, renameSync, rmSync } = require('node:fs')
const { join } = require('node:path')

module.exports = async function afterPack(context) {
  const { appOutDir, packager } = context
  const product = packager.appInfo.productFilename
  const exe = join(appOutDir, `${product}.exe`)
  const core = join(appOutDir, `${product} Core.exe`)
  const launcher = join(__dirname, 'launcher.exe')

  if (!existsSync(launcher)) {
    throw new Error('build/launcher.exe is missing. Run "npm run launcher" before packaging.')
  }
  if (!existsSync(exe)) {
    throw new Error(`Expected the packaged executable at ${exe}`)
  }

  rmSync(core, { force: true })
  renameSync(exe, core)
  copyFileSync(launcher, exe)
}
