declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

/** File System Access API（Chromium 系のみ。lib.dom に未収録の部分） */
interface FilePickerOptions {
  suggestedName?: string
  types?: { description?: string; accept: Record<string, string[]> }[]
  excludeAcceptAllOption?: boolean
}
interface Window {
  showSaveFilePicker?: (options?: FilePickerOptions) => Promise<FileSystemFileHandle>
  showOpenFilePicker?: (options?: FilePickerOptions & { multiple?: boolean }) => Promise<FileSystemFileHandle[]>
}
interface FileSystemHandle {
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
}
interface DataTransferItem {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>
}
