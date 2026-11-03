import { fecha, hoy } from '../lib/formato'

export type Rango = { desde: string; hasta: string }

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const PERIODOS: Record<string, { texto: string; rango: () => Rango }> = {
  mes: {
    texto: 'Este mes',
    rango: () => {
      const d = new Date()
      return { desde: iso(new Date(d.getFullYear(), d.getMonth(), 1)), hasta: hoy() }
    },
  },
  mesAnterior: {
    texto: 'Mes anterior',
    rango: () => {
      const d = new Date()
      return {
        desde: iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)),
        hasta: iso(new Date(d.getFullYear(), d.getMonth(), 0)),
      }
    },
  },
  anio: {
    texto: 'Este año',
    rango: () => ({ desde: `${new Date().getFullYear()}-01-01`, hasta: hoy() }),
  },
  todo: { texto: 'Todo el historial', rango: () => ({ desde: '', hasta: '' }) },
}

export const periodo = (clave: keyof typeof PERIODOS) => PERIODOS[clave].rango()

export function describirPeriodo({ desde, hasta }: Rango) {
  if (desde && hasta) return `Del ${fecha(desde)} al ${fecha(hasta)}`
  if (desde) return `Desde el ${fecha(desde)}`
  if (hasta) return `Hasta el ${fecha(hasta)}`
  return 'Todo el historial'
}

export function SelectorPeriodo({ rango, onCambio }: { rango: Rango; onCambio: (r: Rango) => void }) {
  const actual =
    Object.entries(PERIODOS).find(([, p]) => {
      const r = p.rango()
      return r.desde === rango.desde && r.hasta === rango.hasta
    })?.[0] ?? 'otro'

  return (
    <div className="filtros no-imprimir">
      <select
        aria-label="Periodo"
        value={actual}
        onChange={(e) => e.target.value !== 'otro' && onCambio(PERIODOS[e.target.value].rango())}
      >
        {Object.entries(PERIODOS).map(([clave, p]) => (
          <option key={clave} value={clave}>
            {p.texto}
          </option>
        ))}
        <option value="otro">Otro periodo</option>
      </select>
      <label className="campo-fecha">
        Desde
        <input type="date" value={rango.desde} onChange={(e) => onCambio({ ...rango, desde: e.target.value })} />
      </label>
      <label className="campo-fecha">
        Hasta
        <input type="date" value={rango.hasta} onChange={(e) => onCambio({ ...rango, hasta: e.target.value })} />
      </label>
    </div>
  )
}
