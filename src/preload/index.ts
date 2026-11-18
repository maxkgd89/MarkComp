import { contextBridge, ipcRenderer } from 'electron'

export interface OpenFileResult {
  path: string
  content: string
}

const api = {
  openFile: (): Promise<OpenFileResult | null> => ipcRenderer.invoke('dialog:openFile'),
  loadSample: (): Promise<OpenFileResult | null> => ipcRenderer.invoke('sample:load'),
  saveFile: (path: string, content: string): Promise<{ path: string }> =>
    ipcRenderer.invoke('file:save', path, content),
  saveFileAs: (content: string, defaultName?: string): Promise<{ path: string } | null> =>
    ipcRenderer.invoke('dialog:saveFile', content, defaultName)
}

contextBridge.exposeInMainWorld('api', api)

export type MarkCompApi = typeof api
