export interface OpenFileResult {
  path: string
  content: string
}

export interface MarkCompApi {
  openFile(): Promise<OpenFileResult | null>
  loadSample(): Promise<OpenFileResult | null>
  saveFile(path: string, content: string): Promise<{ path: string }>
  saveFileAs(content: string, defaultName?: string): Promise<{ path: string } | null>
}

declare global {
  interface Window {
    api: MarkCompApi
  }
}
