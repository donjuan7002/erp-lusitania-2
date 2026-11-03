import { anular, METODOS_PAGO, type Pago } from '../lib/datos'
import { mensajeDeError } from '../lib/errores'
import { dinero, fecha } from '../lib/formato'
import type { Mensaje } from './Aviso'

type Props = {
  pago: Pago
  moneda: string
  puedeAnular: boolean
  mostrarCliente?: boolean
  onCambio: () => void
  onMensaje: (m: Mensaje) => void
}

export function FilaPago({ pago: p, moneda, puedeAnular, mostrarCliente = true, onCambio, onMensaje }: Props) {
  async function anularPago() {
    try {
      if (await anular('pagos', p.id, `el pago de ${dinero(p.monto, moneda)}`)) {
        onMensaje({ ok: true, texto: 'Pago anulado.' })
        onCambio()
      }
    } catch (e) {
      onMensaje({ ok: false, texto: mensajeDeError(e) })
    }
  }

  return (
    <div className={`fila${p.anulado ? ' anulado' : ''}`}>
      <span>
        {mostrarCliente ? (p.clientes?.nombre ?? '—') : `Pago del ${fecha(p.fecha)}`}
        <small>
          {mostrarCliente && `${fecha(p.fecha)} · `}
          {METODOS_PAGO[p.metodo] ?? p.metodo}
          {p.notas && ` · ${p.notas}`}
        </small>
        {p.anulado && <small className="mala">Anulado: {p.motivo_anulacion}</small>}
        {puedeAnular && !p.anulado && (
          <button className="enlace" onClick={() => void anularPago()}>
            Anular pago
          </button>
        )}
      </span>
      <b className="num ok">{dinero(p.monto, moneda)}</b>
    </div>
  )
}
