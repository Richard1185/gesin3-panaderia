import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Activity,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Clock3,
  LoaderCircle,
  MessageCircle,
  PackageSearch,
  RefreshCw,
  Settings2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import { currencyTotals, dayKey, isInPeriod, numeric, orderItems, saleDate } from '../shared/analytics'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type {
  ApiRecord,
  AppSettings,
  ChatMessage,
  LiveData,
  Period,
  SaveSettingsInput,
} from '../shared/types'

const emptySettings: AppSettings = {
  apiBaseUrl: '',
  refreshSeconds: 30,
  lmStudioBaseUrl: 'http://127.0.0.1:1234/v1',
  hasApiToken: false,
}

const periods: Array<{ key: Period; label: string }> = [
  { key: 'day', label: 'Día' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mes' },
  { key: 'year', label: 'Año' },
]

type CloseInputs = {
  currency: string
  opening: string
  entries: string
  withdrawals: string
  counted: string
}

const blankClose: CloseInputs = { currency: '', opening: '', entries: '', withdrawals: '', counted: '' }

function money(value: number): string {
  return new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

function orderMatchesPeriod(order: ApiRecord, period: Period): boolean {
  const date = saleDate(order)
  return date !== null && isInPeriod(date, period)
}

function App() {
  const [settings, setSettings] = useState(emptySettings)
  const [data, setData] = useState<LiveData | null>(null)
  const [period, setPeriod] = useState<Period>('day')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [close, setClose] = useState<CloseInputs>(blankClose)

  const refresh = useCallback(async () => {
    if (!settings.apiBaseUrl || !settings.hasApiToken) return
    setLoading(true)
    setError('')
    try {
      const result = await window.panaderia.refreshData()
      setData(result)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [settings.apiBaseUrl, settings.hasApiToken])

  useEffect(() => {
    window.panaderia.getSettings().then((stored) => {
      setSettings(stored)
      if (!stored.apiBaseUrl || !stored.hasApiToken) setSettingsOpen(true)
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }, [])

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`panaderia-close-${dayKey(new Date())}`)
      if (stored) setClose({ ...blankClose, ...JSON.parse(stored) as Partial<CloseInputs> })
    } catch (reason) {
      setError(`No se pudo cargar el cierre local: ${reason instanceof Error ? reason.message : String(reason)}`)
    }
  }, [])

  useEffect(() => {
    if (!settings.apiBaseUrl || !settings.hasApiToken) return
    void refresh()
    const interval = window.setInterval(() => void refresh(), settings.refreshSeconds * 1000)
    return () => window.clearInterval(interval)
  }, [settings.apiBaseUrl, settings.hasApiToken, settings.refreshSeconds, refresh])

  const periodOrders = useMemo(
    () => (data?.orders ?? []).filter((order) => orderMatchesPeriod(order, period)),
    [data, period],
  )
  const todayCash = useMemo(
    () => currencyTotals((data?.orders ?? []).filter((order) => orderMatchesPeriod(order, 'day')), 'cash'),
    [data],
  )

  const productSales = useMemo(() => {
    const products = new Map<string, { code: string; name: string; quantity: number; revenue: number }>()
    for (const order of periodOrders) {
      for (const item of orderItems(order)) {
        const code = String(item.wpcode ?? 'Sin código')
        const quantity = numeric(item.wpqty)
        const entry = products.get(code) ?? {
          code,
          name: String(item.wdesc ?? code),
          quantity: 0,
          revenue: 0,
        }
        entry.quantity += quantity
        entry.revenue += quantity * numeric(item.wprice)
        products.set(code, entry)
      }
    }
    const names = new Map((data?.products ?? []).map((product) => [
      String(product.wpcode ?? ''),
      String(product.wdesc ?? product.wpcode ?? ''),
    ]))
    return Array.from(products.values())
      .map((product) => ({ ...product, name: names.get(product.code) || product.name }))
      .filter((product) => `${product.name} ${product.code}`.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => b.quantity - a.quantity)
  }, [periodOrders, data?.products, query])

  const payments = useMemo(() => ({
    cash: currencyTotals(periodOrders, 'cash'),
    credit: currencyTotals(periodOrders, 'credit'),
    debit: currencyTotals(periodOrders, 'debit'),
  }), [periodOrders])

  const chartData = useMemo(() => {
    const bucketCount = period === 'day' ? 24 : period === 'week' ? 7 : period === 'month' ? 30 : 12
    const buckets = Array.from({ length: bucketCount }, (_, index) => ({
      label: period === 'day' ? `${String(index).padStart(2, '0')}:00` : String(index + 1),
      units: 0,
    }))
    for (const order of periodOrders) {
      const date = saleDate(order)
      if (!date) continue
      const index = period === 'day'
        ? date.getHours()
        : period === 'week'
          ? (date.getDay() + 6) % 7
          : period === 'month'
            ? date.getDate() - 1
            : date.getMonth()
      for (const item of orderItems(order)) buckets[index].units += numeric(item.wpqty)
    }
    if (period === 'week') {
      const weekdays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
      buckets.forEach((bucket, index) => { bucket.label = weekdays[index] })
    } else if (period === 'year') {
      const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
      buckets.forEach((bucket, index) => { bucket.label = months[index] })
    }
    return buckets
  }, [period, periodOrders])

  const projection = useMemo(() => {
    const availableDays = chartData.filter((bucket) => bucket.units > 0).length
    const units = chartData.reduce((sum, bucket) => sum + bucket.units, 0)
    const now = new Date()
    const daysInBucket = period === 'day'
      ? 1
      : period === 'week'
        ? ((now.getDay() + 6) % 7) + 1
        : period === 'month'
          ? now.getDate()
          : now.getMonth() + 1
    return { units, availableDays, dailyAverage: daysInBucket ? units / daysInBucket : 0 }
  }, [chartData, period])

  const closeCurrency = close.currency || todayCash[0]?.currency || '1'
  const closeCashSales = todayCash.find((item) => item.currency === closeCurrency)?.amount ?? 0
  const closeExpected = numeric(close.opening) + closeCashSales
    + numeric(close.entries) - numeric(close.withdrawals)
  const closeDifference = close.counted === '' ? null : numeric(close.counted) - closeExpected
  const datesMissing = Boolean(data?.orders.length && data.orders.every((order) => saleDate(order) === null))

  async function saveSettings(input: SaveSettingsInput) {
    const saved = await window.panaderia.saveSettings(input)
    setSettings(saved)
    setSettingsOpen(false)
  }

  function updateClose(field: keyof CloseInputs, value: string) {
    const next = { ...close, [field]: value }
    try {
      localStorage.setItem(`panaderia-close-${dayKey(new Date())}`, JSON.stringify(next))
      setClose(next)
      setError('')
    } catch (reason) {
      setError(`No se pudo guardar el cierre local: ${reason instanceof Error ? reason.message : String(reason)}`)
    }
  }

  async function toggleAssistant() {
    const opening = !assistantOpen
    setAssistantOpen(opening)
    if (opening && models.length === 0) {
      try {
        setModels(await window.panaderia.listLocalModels())
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    }
  }

  async   function sendChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const prompt = chatInput.trim()
    if (!prompt || chatBusy) return
    const nextMessages = [...messages, { role: 'user' as const, content: prompt }]
    setMessages(nextMessages)
    setChatInput('')
    setChatBusy(true)
    try {
      const answer = await window.panaderia.askLocalAssistant(prompt, messages, data)
      setMessages([...nextMessages, { role: 'assistant', content: answer }])
    } catch (reason) {
      setMessages([...nextMessages, {
        role: 'assistant',
        content: `No se pudo consultar la IA local: ${reason instanceof Error ? reason.message : String(reason)}`,
      }])
    } finally {
      setChatBusy(false)
    }
  }

  const connectionReady = Boolean(settings.apiBaseUrl && settings.hasApiToken)

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">M</span>
          <div><strong>Mostrador</strong><small>Consultas de panadería</small></div>
        </div>
        <div className="top-actions">
          <span className={`connection ${connectionReady && !error ? 'online' : 'offline'}`}>
            {connectionReady && !error ? <Wifi size={14} /> : <WifiOff size={14} />}
            {connectionReady && !error ? 'Conectado' : 'Sin conexión'}
          </span>
          {data && <span className="updated"><Clock3 size={13} /> {new Date(data.refreshedAt).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}</span>}
          <button className="icon-button" aria-label="Actualizar ahora" onClick={() => void refresh()} disabled={loading}>
            {loading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
          </button>
          <button className="icon-button" aria-label="Configuración de conexión" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></button>
        </div>
      </header>

      <section className="toolbar">
        <div><h1>Resumen de ventas</h1><p>Ventas, productos y caja en vivo</p></div>
        <div className="period-switch" aria-label="Período de consulta">
          {periods.map((item) => <button key={item.key} className={period === item.key ? 'selected' : ''} onClick={() => setPeriod(item.key)}>{item.label}</button>)}
        </div>
      </section>

      {error && <div className="notice error"><CircleAlert size={16} /><span>{error}</span><button className="plain-button" onClick={() => setError('')} aria-label="Cerrar aviso"><X size={15} /></button></div>}
      {datesMissing && <div className="notice warning"><CircleAlert size={16} /><span>No se detectó el campo de fecha de venta en los pedidos recibidos. Se necesita validar el nombre del campo de la respuesta para agrupar correctamente por período.</span></div>}
      {!connectionReady && <div className="notice info"><WifiOff size={16} /><span>Configura la URL y el token para consultar la facturación en directo.</span><button className="text-button" onClick={() => setSettingsOpen(true)}>Configurar</button></div>}

      <section className="summary-grid">
        <article className="summary-card"><div className="card-label"><span>Ventas registradas</span><Activity size={16} /></div><strong>{periodOrders.length}</strong><small>pedidos · {periods.find((item) => item.key === period)?.label.toLowerCase()}</small></article>
        <article className="summary-card"><div className="card-label"><span>Unidades vendidas</span><PackageSearch size={16} /></div><strong>{projection.units.toLocaleString('es-VE')}</strong><small>promedio {projection.dailyAverage.toFixed(1)} unidades/día</small></article>
        <PaymentCard title="Efectivo" icon="Bs" values={payments.cash} />
        <PaymentCard title="Tarjeta crédito" icon="Cr" values={payments.credit} />
        <PaymentCard title="Tarjeta débito" icon="Db" values={payments.debit} />
      </section>

      <section className="content-grid">
        <article className="panel chart-panel">
          <div className="panel-heading"><div><h2>Ritmo de ventas</h2><p>Unidades por {period === 'day' ? 'hora' : period === 'week' ? 'día' : period === 'month' ? 'día' : 'mes'}</p></div><span className="live-dot">Actualizando</span></div>
          {data && !datesMissing ? (
            <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="#edf0eb" vertical={false} />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#89918a', fontSize: 11 }} interval={period === 'month' ? 4 : 0} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#89918a', fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="units" name="Unidades" stroke="#4a8b62" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
            </LineChart></ResponsiveContainer></div>
          ) : <EmptyState text={datesMissing ? 'Se requiere validar el campo de fecha de venta.' : 'Conecta la API para ver el movimiento de ventas.'} />}
          <div className="projection-note"><Activity size={14} /><span>Proyección inicial: promedio simple de <b>{projection.dailyAverage.toFixed(1)} unidades por día</b>, según el período visible.</span></div>
        </article>

        <article className="panel close-panel">
          <div className="panel-heading"><div><h2>Cierre de caja · Hoy</h2><p>Efectivo esperado frente al contado</p></div><span className="close-badge">En curso</span></div>
          <div className="close-inputs">
            <label className="money-input"><span>Moneda del conteo</span><select value={closeCurrency} onChange={(event) => updateClose('currency', event.target.value)}>{(todayCash.length ? todayCash : [{ currency: '1', amount: 0 }]).map((item) => <option key={item.currency} value={item.currency}>Moneda {item.currency}</option>)}</select></label>
            <MoneyInput label="Fondo inicial" value={close.opening} onChange={(value) => updateClose('opening', value)} />
            <MoneyInput label="Entradas" value={close.entries} onChange={(value) => updateClose('entries', value)} />
            <MoneyInput label="Retiros / salidas" value={close.withdrawals} onChange={(value) => updateClose('withdrawals', value)} />
            <MoneyInput label="Efectivo contado" value={close.counted} onChange={(value) => updateClose('counted', value)} />
          </div>
          <div className="expected-row"><span>Efectivo esperado · moneda {closeCurrency}</span><b>{money(closeExpected)}</b></div>
          <div className={`difference-row ${closeDifference === null ? '' : closeDifference === 0 ? 'balanced' : 'unbalanced'}`}>
            <span>Diferencia</span><b>{closeDifference === null ? '—' : money(closeDifference)}</b>
          </div>
          <div className="z-placeholder"><span>Cierre Z</span><b>Disponibilidad en API por verificar</b></div>
        </article>
      </section>

      <section className="panel products-panel">
        <div className="panel-heading product-heading">
          <div><h2>Productos vendidos</h2><p>Unidades y venta estimada por producto</p></div>
          <label className="search-box"><PackageSearch size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto…" /></label>
        </div>
        {productSales.length ? <div className="table-scroll"><table>
          <thead><tr><th>Producto</th><th>Código</th><th>Unidades</th><th>Venta estimada</th></tr></thead>
          <tbody>{productSales.slice(0, 8).map((product) => <tr key={product.code}>
            <td className="product-name">{product.name}</td><td className="muted-cell">{product.code}</td><td>{product.quantity.toLocaleString('es-VE')}</td><td>{money(product.revenue)}</td>
          </tr>)}</tbody>
        </table></div> : <EmptyState text={data && !datesMissing ? 'No hay ventas para este período o búsqueda.' : 'Las ventas por producto aparecerán al recibir pedidos con fecha.'} compact />}
      </section>

      <button className={`assistant-toggle ${assistantOpen ? 'opened' : ''}`} onClick={() => void toggleAssistant()} aria-expanded={assistantOpen}>
        <span className="assistant-icon"><Bot size={17} /></span><span>Asistente IA</span>
        {models.length > 0 && <span className="model-ready"><Check size={12} /> Local</span>}
        {assistantOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      {assistantOpen && <section className="assistant-panel">
        <div className="assistant-header"><div><MessageCircle size={16} /><b>Consulta tus ventas</b></div><span>{models[0] ? `Modelo local: ${models[0]}` : 'LM Studio local'}</span></div>
        <div className="chat-messages">
          {messages.length === 0 && <p className="chat-intro">Pregunta, por ejemplo: «¿Cuántas unidades se vendieron esta semana?» La respuesta se basa en los últimos datos consultados.</p>}
          {messages.map((message, index) => <div className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>{message.content}</div>)}
          {chatBusy && <div className="chat-message assistant"><LoaderCircle className="spin" size={15} /> Consultando el modelo local…</div>}
        </div>
        <form className="chat-form" onSubmit={(event) => void sendChat(event)}>
          <input value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Escribe una consulta…" aria-label="Consulta para la IA" />
          <button type="submit" disabled={chatBusy || !chatInput.trim()}>Enviar</button>
        </form>
      </section>}

      {settingsOpen && <SettingsDialog settings={settings} onClose={() => setSettingsOpen(false)} onSave={saveSettings} />}
      <footer className="app-footer"><span>Datos consultados directamente desde la facturación</span><span>Actualización automática cada {settings.refreshSeconds} s</span></footer>
    </main>
  )
}

function PaymentCard({ title, icon, values }: { title: string; icon: string; values: Array<{ currency: string; amount: number }> }) {
  return <article className="summary-card payment-card">
    <div className="card-label"><span>{title}</span><i>{icon}</i></div>
    {values.length === 1
      ? <><strong>{money(values[0].amount)}</strong><small>Moneda {values[0].currency}</small></>
      : values.length > 1
        ? <><strong>Varias monedas</strong><small>{values.map((item) => `${item.currency}: ${money(item.amount)}`).join(' · ')}</small></>
        : <><strong>—</strong><small>sin pagos clasificados</small></>}
  </article>
}

function MoneyInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="money-input"><span>{label}</span><input type="number" min="0" step="0.01" value={value} onChange={(event) => onChange(event.target.value)} placeholder="0,00" /></label>
}

function EmptyState({ text, compact = false }: { text: string; compact?: boolean }) {
  return <div className={`empty-state ${compact ? 'compact' : ''}`}><PackageSearch size={compact ? 18 : 23} /><span>{text}</span></div>
}

function SettingsDialog({
  settings,
  onClose,
  onSave,
}: {
  settings: AppSettings
  onClose: () => void
  onSave: (input: SaveSettingsInput) => Promise<void>
}) {
  const [apiBaseUrl, setApiBaseUrl] = useState(settings.apiBaseUrl)
  const [apiToken, setApiToken] = useState('')
  const [refreshSeconds, setRefreshSeconds] = useState(String(settings.refreshSeconds))
  const [lmStudioBaseUrl, setLmStudioBaseUrl] = useState(settings.lmStudioBaseUrl)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave({
        apiBaseUrl,
        apiToken,
        refreshSeconds: Number(refreshSeconds),
        lmStudioBaseUrl,
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  return <div className="modal-scrim" role="presentation">
    <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="dialog-heading"><div><span className="dialog-icon"><Settings2 size={17} /></span><div><h2 id="settings-title">Conexiones</h2><p>Las credenciales se guardan cifradas en este equipo.</p></div></div><button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={17} /></button></div>
      <form onSubmit={(event) => void submit(event)} className="settings-form">
        <label>URL base de la API de facturación<input value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} placeholder="https://servidor/…/sd3xd_api" required /></label>
        <label>Token de API <small>{settings.hasApiToken ? 'Ya hay un token guardado; deja en blanco para conservarlo.' : 'El token no se comparte con la interfaz ni se guarda en texto plano.'}</small><input type="password" value={apiToken} onChange={(event) => setApiToken(event.target.value)} placeholder={settings.hasApiToken ? 'Token guardado' : 'Pega el token'} autoComplete="new-password" /></label>
        <label>Frecuencia de actualización<input type="number" min="10" max="300" value={refreshSeconds} onChange={(event) => setRefreshSeconds(event.target.value)} /><small>Entre 10 y 300 segundos.</small></label>
        <label>Dirección local de LM Studio<input value={lmStudioBaseUrl} onChange={(event) => setLmStudioBaseUrl(event.target.value)} required /></label>
        {error && <div className="form-error"><CircleAlert size={15} />{error}</div>}
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button type="submit" className="primary-button" disabled={saving}>{saving ? 'Guardando…' : 'Guardar conexión'}</button></div>
      </form>
    </section>
  </div>
}

export default App
