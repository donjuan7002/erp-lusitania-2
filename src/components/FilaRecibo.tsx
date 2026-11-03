import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { anular, type Recibo } from '../lib/datos'
import { mensajeDeError } from '../lib/errores'
import { dinero, fecha, hoy, kg, leerNumero, porcentaje } from '../lib/formato'
import type { Mensaje } from './Aviso'

type Props = {
  recibo: Recibo
  verDinero: boolean
  moneda: string
  puedeEntregar: boolean
  puedeAnular: boolean
  mostrarCliente?: boolean
  onCambio: () => void
  onMensaje: (m: Mensaje) => void
}

export function FilaRecibo({ recibo: r, verDinero, moneda, puedeEntregar, puedeAnular, mostrarCliente = true, onCambio, onMensaje }: Props) {
  async function anularRegistro(tabla: 'recibos' | 'entregas', id: string, descripcion: string) {
    try {
      if (await anular(tabla, id, descripcion)) {
        onMensaje({ ok: true, texto: tabla === 'recibos' ? 'Recibo anulado.' : 'Entrega anulada: el recibo vuelve a estar en proceso.' })
        onCambio()
      }
    } catch (e) {
      onMensaje({ ok: false, texto: mensajeDeError(e) })
    }
  }

  return (
    <div className={`fila bloque${r.anulado ? ' anulado' : ''}`}>
      <div className="fila-cabeza">
        <span>
          {mostrarCliente ? r.cliente_nombre : `Recibo del ${fecha(r.fecha)}`}
          <small>
            {mostrarCliente && fecha(r.fecha)}
            {verDinero && r.cobro != null && `${mostrarCliente ? ' · ' : ''}cobro ${dinero(r.cobro, moneda)}`}
          </small>
        </span>
        <b className="num">{kg(r.kg_pergamino)} perg.</b>
      </div>

      {r.anulado ? (
        <small className="mala">Anulado: {r.motivo_anulacion}</small>
      ) : r.entrega_id ? (
        <div className="fila-cabeza">
          <small className="ok">
            Entregado el {fecha(r.fecha_entrega)}: {kg(r.kg_oro)} de oro, rendimiento {porcentaje(r.rendimiento)}
            {verDinero && r.costo_kg_oro != null && `, ${dinero(r.costo_kg_oro, moneda)} por kg de oro`}
          </small>
          {puedeAnular && (
            <button className="enlace" onClick={() => void anularRegistro('entregas', r.entrega_id!, 'la entrega')}>
              Anular entrega
            </button>
          )}
        </div>
      ) : (
        <>
          {puedeEntregar ? (
            <FormEntrega recibo={r} onCambio={onCambio} onMensaje={onMensaje} />
          ) : (
            <small className="sub">En proceso</small>
          )}
          {puedeAnular && (
            <button className="enlace" onClick={() => void anularRegistro('recibos', r.id, 'el recibo')}>
              Anular recibo
            </button>
          )}
        </>
      )}
    </div>
  )
}

function FormEntrega({ recibo, onCambio, onMensaje }: { recibo: Recibo; onCambio: () => void; onMensaje: (m: Mensaje) => void }) {
  const [oro, setOro] = useState('')
  const [dia, setDia] = useState(hoy)
  const [enviando, setEnviando] = useState(false)

  async function registrar(e: FormEvent) {
    e.preventDefault()
    const kgOro = leerNumero(oro)
    if (!(kgOro > 0)) return onMensaje({ ok: false, texto: 'Escribe los kg de oro obtenidos.' })
    if (kgOro > Number(recibo.kg_pergamino)) {
      return onMensaje({ ok: false, texto: 'Los kg de oro no pueden superar los kg de pergamino recibidos.' })
    }
    setEnviando(true)
    const { error } = await supabase.from('entregas').insert({ recibo_id: recibo.id, kg_oro: kgOro, fecha: dia })
    setEnviando(false)
    if (error) return onMensaje({ ok: false, texto: mensajeDeError(error) })
    onMensaje({
      ok: true,
      texto: `Entrega registrada: ${kg(kgOro)} de oro (${porcentaje((kgOro / Number(recibo.kg_pergamino)) * 100)}).`,
    })
    onCambio()
  }

  return (
    <form className="en-linea" onSubmit={registrar}>
      <input
        aria-label={`Kg de oro de ${recibo.cliente_nombre}`}
        inputMode="decimal"
        placeholder="kg de oro obtenidos"
        value={oro}
        onChange={(e) => setOro(e.target.value)}
      />
      <input
        aria-label="Fecha de entrega"
        type="date"
        className="fecha"
        min={recibo.fecha}
        max={hoy()}
        value={dia}
        onChange={(e) => setDia(e.target.value)}
      />
      <button type="submit" className="secundario" disabled={enviando}>
        Registrar entrega
      </button>
    </form>
  )
}
