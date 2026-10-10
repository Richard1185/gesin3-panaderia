import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { orderItems, orderPayments, saleDate } from '../shared/analytics'
import type {
  ApiRecord,
  ApiResult,
  AppSettings,
  ChatMessage,
  LiveData,
  SaveSettingsInput,
} from '../shared/types'

interface PersistedSettings {
  apiBaseUrl: string
  encryptedApiToken?: string
  refreshSeconds: number
  lmStudioBaseUrl: string
}

const defaults: PersistedSettings = {
  apiBaseUrl: '',
  refreshSeconds: 30,
  lmStudioBaseUrl: 'http://127.0.0.1:1234/v1',
}

const settingsPath = () => join(app.getPath('userData'), 'settings.json')

async function readSettings(): Promise<PersistedSettings> {
  try {
    const contents = await readFile(settingsPath(), 'utf8')
    return { ...defaults, ...JSON.parse(contents) as Partial<PersistedSettings> }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...defaults }
    throw new Error(`No se pudo leer la configuración local: ${errorMessage(error)}`)
  }
}

function toPublicSettings(settings: PersistedSettings): AppSettings {
  return {
    apiBaseUrl: settings.apiBaseUrl,
    refreshSeconds: settings.refreshSeconds,
    lmStudioBaseUrl: settings.lmStudioBaseUrl,
    hasApiToken: Boolean(settings.encryptedApiToken),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function validateApiUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('La URL de la API debe usar HTTPS (HTTP solo se permite en localhost).')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('La URL de la API no debe contener credenciales, parámetros ni fragmentos.')
  }
  return url.toString().replace(/\/+$/, '')
}

function validateLocalUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('LM Studio debe estar en HTTP y en este equipo (localhost).')
  }
  return url.toString().replace(/\/+$/, '')
}

async function getApiToken(settings: PersistedSettings): Promise<string> {
  if (!settings.encryptedApiToken) {
    throw new Error('Configura la URL y el token de la API para conectarte.')
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('El almacenamiento seguro del sistema no está disponible; no se guardó ni se usó el token.')
  }
  return safeStorage.decryptString(Buffer.from(settings.encryptedApiToken, 'base64'))
}

async function callApi<T extends ApiResult>(
  settings: PersistedSettings,
  endpoint: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const baseUrl = validateApiUrl(settings.apiBaseUrl)
  const token = await getApiToken(settings)
  const response = await fetch(`${baseUrl}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  })
  const body = await response.text()
  let result: T
  try {
    result = JSON.parse(body) as T
  } catch {
    throw new Error(`${endpoint}: la API respondió con contenido que no es JSON (HTTP ${response.status}).`)
  }
  if (!response.ok || result.status !== true) {
    throw new Error(`${endpoint}: ${result.message || `error HTTP ${response.status}`}`)
  }
  return result
}

function responseRecords(result: ApiResult, endpoint: string): ApiRecord[] {
  if (!Array.isArray(result.data)) {
    throw new Error(`${endpoint}: la respuesta no contiene la lista de datos esperada.`)
  }
  return result.data
}

async function refreshData(): Promise<LiveData> {
  const settings = await readSettings()
  const [health, ordersResponse, productsResponse] = await Promise.all([
    callApi<ApiResult>(settings, 'check_status.php'),
    callApi<ApiResult>(settings, 'consultar_pedidos.php'),
    callApi<ApiResult>(settings, 'consultar_productos.php'),
  ])
  return {
    health,
    orders: responseRecords(ordersResponse, 'consultar_pedidos.php'),
    products: responseRecords(productsResponse, 'consultar_productos.php'),
    refreshedAt: new Date().toISOString(),
  }
}

function localApiUrl(settings: PersistedSettings, endpoint: string): string {
  const url = new URL(`${validateLocalUrl(settings.lmStudioBaseUrl)}/${endpoint}`)
  return url.toString()
}

async function listLocalModels(): Promise<string[]> {
  const settings = await readSettings()
  const response = await fetch(localApiUrl(settings, 'models'), {
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error(`LM Studio respondió HTTP ${response.status}.`)
  const result = await response.json() as { data?: Array<{ id?: string }> }
  return (result.data ?? []).flatMap((model) => model.id ? [model.id] : [])
}

function buildContext(data: LiveData | null): string {
  if (!data) return 'No hay datos de facturación cargados.'
  const orders = data.orders.slice(0, 500).map((order) => ({
    date: saleDate(order)?.toISOString() ?? null,
    items: orderItems(order).map((item) => ({
      productCode: String(item.wpcode ?? ''),
      quantity: Number(item.wpqty) || 0,
      unitPrice: Number(item.wprice) || 0,
    })),
    payments: orderPayments(order).map((payment) => ({
      type: String(payment.wtipopago ?? ''),
      amount: Number(payment.wmonto) || 0,
      currency: String(payment.widmoneda ?? ''),
    })),
  }))
  const products = data.products.slice(0, 500).map((product) => ({
    code: String(product.wpcode ?? ''),
    name: String(product.wdesc ?? ''),
    price: Number(product.wprice) || 0,
    stock: Number(product.wexiste) || 0,
  }))
  return JSON.stringify({
    orders,
    products,
    truncated: data.orders.length > orders.length || data.products.length > products.length,
    refreshedAt: data.refreshedAt,
  })
}

async function askLocalAssistant(
  prompt: string,
  messages: ChatMessage[],
  data: LiveData | null,
): Promise<string> {
  const settings = await readSettings()
  const models = await listLocalModels()
  const model = models[0]
  if (!model) throw new Error('LM Studio está disponible, pero no tiene un modelo cargado.')
  const history = messages.slice(-10).map(({ role, content }) => ({
    role,
    content: content.slice(0, 4_000),
  }))
  const response = await fetch(localApiUrl(settings, 'chat/completions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: `Eres un asistente de análisis de una panadería. Responde en español, usando solo los datos suministrados. No inventes cifras. Si falta fecha, medio de pago o información del cierre Z, dilo claramente. El contexto excluye datos personales; si truncated es true, solo representa una muestra parcial y no debes presentarla como total completo. No solicites ni reveles credenciales. Datos actuales: ${buildContext(data)}`,
        },
        ...history,
        { role: 'user', content: prompt.slice(0, 4_000) },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  })
  const result = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>
    error?: { message?: string }
  }
  if (!response.ok) throw new Error(result.error?.message || `LM Studio respondió HTTP ${response.status}.`)
  const content = result.choices?.[0]?.message?.content
  if (!content) throw new Error('LM Studio no devolvió una respuesta de texto.')
  return content
}

function registerHandlers(): void {
  ipcMain.handle('settings:get', async () => toPublicSettings(await readSettings()))
  ipcMain.handle('settings:save', async (_event, input: SaveSettingsInput) => {
    const current = await readSettings()
    const apiBaseUrl = input.apiBaseUrl.trim() ? validateApiUrl(input.apiBaseUrl.trim()) : ''
    const refreshSeconds = Math.min(300, Math.max(10, Math.round(Number(input.refreshSeconds) || 30)))
    const next: PersistedSettings = {
      ...current,
      apiBaseUrl,
      refreshSeconds,
      lmStudioBaseUrl: validateLocalUrl(input.lmStudioBaseUrl.trim()),
    }
    if (input.apiToken?.trim()) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('El almacenamiento seguro del sistema no está disponible; el token no se guardó.')
      }
      next.encryptedApiToken = safeStorage.encryptString(input.apiToken.trim()).toString('base64')
    }
    await writeFile(settingsPath(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    return toPublicSettings(next)
  })
  ipcMain.handle('data:refresh', () => refreshData())
  ipcMain.handle('assistant:models', () => listLocalModels())
  ipcMain.handle('assistant:ask', (_event, prompt: string, messages: ChatMessage[], data: LiveData | null) =>
    askLocalAssistant(prompt, messages, data))
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#f7f7f4',
    title: 'Consultas Panadería',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    const allowedUrl = process.env.ELECTRON_RENDERER_URL
    if (allowedUrl && new URL(url).origin === new URL(allowedUrl).origin) return
    if (!allowedUrl && url.startsWith('file://')) return
    event.preventDefault()
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerHandlers()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
