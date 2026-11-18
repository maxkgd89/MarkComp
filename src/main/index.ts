import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { mkdirSync } from 'fs'

// --- Launch compatibility -------------------------------------------------
// Chromium's sandbox and the default user-data location both crash this
// Electron build in the current Windows environment (0xC0000005). The process
// is only able to write inside the project directory, so use a workspace-local
// user-data folder and fall back to the OS locations only if needed. The npm
// scripts also pass --noSandbox.
const dataDirCandidates = [
  join(app.getAppPath(), '.userdata'),
  join(app.getPath('appData'), 'markdown-review-studio'),
  join(app.getPath('temp'), 'markdown-review-studio')
]

let dataDir: string | undefined
for (const candidate of dataDirCandidates) {
  try {
    mkdirSync(candidate, { recursive: true })
    dataDir = candidate
    break
  } catch {
    // try the next candidate
  }
}
if (dataDir) app.setPath('userData', dataDir)
app.commandLine.appendSwitch('no-sandbox')

const rendererUrl = process.env['ELECTRON_RENDERER_URL']

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Markdown Review Studio',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open Markdown file',
      properties: ['openFile'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const content = await readFile(filePath, 'utf-8')
    return { path: filePath, content }
  })

  ipcMain.handle('sample:load', async () => {
    const candidates = [
      join(app.getAppPath(), 'samples', 'sample.md'),
      join(process.cwd(), 'samples', 'sample.md')
    ]
    for (const candidate of candidates) {
      try {
        const content = await readFile(candidate, 'utf-8')
        return { path: candidate, content }
      } catch {
        // try the next candidate
      }
    }
    return null
  })

  ipcMain.handle('file:save', async (_event, filePath: string, content: string) => {
    await writeFile(filePath, content, 'utf-8')
    return { path: filePath }
  })

  ipcMain.handle('dialog:saveFile', async (_event, content: string, defaultName?: string) => {
    const result = await dialog.showSaveDialog({
      title: 'Save revised Markdown',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath: defaultName ?? 'revision.md'
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, content, 'utf-8')
    return { path: result.filePath }
  })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
