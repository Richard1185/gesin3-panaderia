import type { ApiRecord, Period } from './types'

export function numeric(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function saleDate(order: ApiRecord): Date | null {
  const entries = Object.entries(order).filter(([key]) =>
    /fecha|date|time|timestamp|created_at/i.test(key),
  )
  for (const [, value] of entries) {
    if (typeof value === 'number' && value > 0) {
      const timestamp = value < 10_000_000_000 ? value * 1000 : value
      const date = new Date(timestamp)
      if (!Number.isNaN(date.getTime())) return date
    }
    if (typeof value === 'string' && value.trim()) {
      const date = new Date(value.replace(' ', 'T'))
      if (!Number.isNaN(date.getTime())) return date
    }
  }
  return null
}

export function isInPeriod(date: Date, period: Period): boolean {
  const now = new Date()
  if (period === 'day') return date.toDateString() === now.toDateString()
  if (period === 'week') {
    const start = new Date(now)
    const day = (start.getDay() + 6) % 7
    start.setDate(start.getDate() - day)
    start.setHours(0, 0, 0, 0)
    return date >= start && date <= now
  }
  if (period === 'month') return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
  return date.getFullYear() === now.getFullYear()
}

export function paymentKind(payment: ApiRecord): 'cash' | 'credit' | 'debit' | 'other' {
  const type = String(payment.wtipopago ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  if (type.includes('efectivo') || type.includes('cash')) return 'cash'
  if (type.includes('credito') || type.includes('credit')) return 'credit'
  if (type.includes('debito') || type.includes('debit')) return 'debit'
  return 'other'
}

export function orderItems(order: ApiRecord): ApiRecord[] {
  return Array.isArray(order.items)
    ? order.items.filter((item): item is ApiRecord => typeof item === 'object' && item !== null)
    : []
}

export function orderPayments(order: ApiRecord): ApiRecord[] {
  return Array.isArray(order.pagos)
    ? order.pagos.filter((item): item is ApiRecord => typeof item === 'object' && item !== null)
    : []
}

export function currencyTotals(orders: ApiRecord[], kind: 'cash' | 'credit' | 'debit') {
  const totals = new Map<string, number>()
  for (const order of orders) {
    for (const payment of orderPayments(order)) {
      if (paymentKind(payment) !== kind) continue
      const currency = String(payment.widmoneda ?? 'Moneda sin identificar')
      totals.set(currency, (totals.get(currency) ?? 0) + numeric(payment.wmonto))
    }
  }
  return Array.from(totals, ([currency, amount]) => ({ currency, amount }))
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
