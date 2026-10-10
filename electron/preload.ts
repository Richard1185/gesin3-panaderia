import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge } from '../shared/types'

const bridge: DesktopBridge = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  refreshData: () => ipcRenderer.invoke('data:refresh'),
  listLocalModels: () => ipcRenderer.invoke('assistant:models'),
  askLocalAssistant: (prompt, messages, data) =>
    ipcRenderer.invoke('assistant:ask', prompt, messages, data),
}

contextBridge.exposeInMainWorld('panaderia', bridge)
