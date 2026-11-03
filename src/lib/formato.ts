const numero = new Intl.NumberFormat('es', { maximumFractionDigits: 2 })

export const num = (n: unknown) => numero.format(Number(n) || 0)
export const kg = (n: unknown) => `${num(n)} kg`
export const porcentaje = (n: unknown) => (n == null ? '—' : `${num(n)}%`)

export function dinero(n: unknown, moneda = '$') {
  const valor = Number(n) || 0
  return `${valor < 0 ? '−' : ''}${moneda}${numero.format(Math.abs(valor))}`
}

// Las fechas llegan como 'AAAA-MM-DD' y se muestran en la zona local.
export function fecha(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('es', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function hoy() {
  const d = new Date()
  const dos = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`
}

// Acepta coma o punto decimal (los teclados en español suelen dar coma).
export function leerNumero(texto: string): number {
  const limpio = texto.trim().replace(/\s/g, '').replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(limpio)) return NaN
  return Number(limpio)
}
