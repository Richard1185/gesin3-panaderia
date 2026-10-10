export type Period = 'day' | 'week' | 'month' | 'year'

export interface AppSettings {
  apiBaseUrl: string
  refreshSeconds: number
  lmStudioBaseUrl: string
  hasApiToken: boolean
}

export interface SaveSettingsInput {
  apiBaseUrl: string
  apiToken?: string
  refreshSeconds: number
  lmStudioBaseUrl: string
}

export interface ApiRecord {
  [key: string]: unknown
}

export interface ApiResult {
  status: boolean
  count?: number
  data?: ApiRecord[]
  detalles?: ApiRecord
  message?: string
}

export interface LiveData {
  orders: ApiRecord[]
  products: ApiRecord[]
  health: ApiResult
  refreshedAt: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface DesktopBridge {
  getSettings: () => Promise<AppSettings>
  saveSettings: (settings: SaveSettingsInput) => Promise<AppSettings>
  refreshData: () => Promise<LiveData>
  listLocalModels: () => Promise<string[]>
  askLocalAssistant: (prompt: string, messages: ChatMessage[], data: LiveData | null) => Promise<string>
}
