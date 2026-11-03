import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { supabase } from '../lib/supabase'
import { mensajeDeError } from '../lib/errores'
import { METODOS_PAGO, obtenerConfiguracion, useCarga, type EstadoCuenta as Datos, type Movimiento } from '../lib/datos'
import { dinero, fecha, hoy, kg, porcentaje } from '../lib/formato'
import { exportarExcel, FORMATO_DINERO, nombreArchivo } from '../lib/excel'
import { Aviso, type Mensaje } from '../components/Aviso'
import { describirPeriodo, periodo, SelectorPeriodo, type Rango } from '../components/Periodo'

function concepto(m: Movimiento, moneda: string) {
  if (m.tipo === 'pago') return `Pago (${METODOS_PAGO[m.metodo ?? ''] ?? m.metodo})${m.notas ? ` · ${m.notas}` : ''}`
  const base = `Trilla de ${kg(m.kg_pergamino)} de pergamino a ${dinero(m.tarifa_aplicada, moneda)}/kg`
  return m.kg_oro == null ? `${base} · en proceso` : `${base} · ${kg(m.kg_oro)} de oro (${porcentaje(m.rendimiento)})`
}

// Estado de cuenta imprimible de un cliente (admin y consulta).
export default function EstadoCuenta() {
  const { id = '' } = useParams()
  const [rango, setRango] = useState<Rango>(() => periodo('todo'))
  const [mensaje, setMensaje] = useState<Mensaje>(null)

  const config = useCarga(() => obtenerConfiguracion(), [])
  const estado = useCarga(async () => {
    const { data, error } = await supabase.rpc('estado_cuenta', {
      cliente: id,
      desde: rango.desde || null,
      hasta: rango.hasta || null,
    })
    if (error) throw error
    return data as Datos
  }, [id, rango])

  const moneda = config.datos?.moneda ?? '$'
  const negocio = config.datos?.nombre_negocio ?? 'Trilla de café'
  const d = estado.datos

  // Saldo después de cada movimiento.
  let corrido = Number(d?.saldo_inicial ?? 0)
  const filas = (d?.movimientos ?? []).map((m) => {
    corrido += Number(m.cargo ?? 0) - Number(m.abono ?? 0)
    return { ...m, saldo: corrido }
  })
  const totalCargos = filas.reduce((s, m) => s + Number(m.cargo ?? 0), 0)
  const totalAbonos = filas.reduce((s, m) => s + Number(m.abono ?? 0), 0)
  const saldoFinal = corrido
  const corte = rango.hasta || hoy()

  async function excel() {
    if (!d) return
    try {
      await exportarExcel(`estado-cuenta-${nombreArchivo(d.cliente.nombre)}-${corte}.xlsx`, [
        {
          nombre: 'Estado de cuenta',
          encabezado: [negocio, `Estado de cuenta de ${d.cliente.nombre}`, describirPeriodo(rango)],
          columnas: [
            { titulo: 'Fecha', ancho: 12 },
            { titulo: 'Concepto', ancho: 60 },
            { titulo: `Cargo (${moneda})`, ancho: 16, formato: FORMATO_DINERO },
            { titulo: `Abono (${moneda})`, ancho: 16, formato: FORMATO_DINERO },
            { titulo: `Saldo (${moneda})`, ancho: 16, formato: FORMATO_DINERO },
          ],
          filas: [
            [d.desde ?? '', 'Saldo anterior', null, null, Number(d.saldo_inicial)],
            ...filas.map((m) => [
              m.fecha,
              concepto(m, moneda),
              m.cargo == null ? null : Number(m.cargo),
              m.abono == null ? null : Number(m.abono),
              m.saldo,
            ]),
          ],
          totales: ['', 'Totales y saldo final', totalCargos, totalAbonos, saldoFinal],
        },
      ])
    } catch (e) {
      setMensaje({ ok: false, texto: `No se pudo exportar: ${mensajeDeError(e)}` })
    }
  }

  async function compartir() {
    if (!d) return
    const texto =
      `${negocio}\nEstado de cuenta de ${d.cliente.nombre}\n${describirPeriodo(rango)}\n\n` +
      `Cargos: ${dinero(totalCargos, moneda)}\nAbonos: ${dinero(totalAbonos, moneda)}\n` +
      `Saldo al ${fecha(corte)}: ${dinero(saldoFinal, moneda)}`
    try {
      if (navigator.share) await navigator.share({ title: `Estado de cuenta · ${d.cliente.nombre}`, text: texto })
      else {
        await navigator.clipboard.writeText(texto)
        setMensaje({ ok: true, texto: 'Resumen copiado. Pégalo en WhatsApp o en un correo.' })
      }
    } catch {
      // La persona canceló el menú de compartir.
    }
  }

  return (
    <>
      <p className="sin-margen no-imprimir">
        <Link to={`/clientes/${id}`}>← Volver al cliente</Link>
      </p>
      <div className="solo-imprimir">
        <p className="sin-margen">
          <b>{negocio}</b>
        </p>
        <p className="sub">Generado el {new Date().toLocaleDateString('es', { dateStyle: 'long' })}</p>
      </div>
      <h1>Estado de cuenta</h1>
      {d && (
        <p className="sub">
          <b>{d.cliente.nombre}</b>
          {d.cliente.telefono && ` · ${d.cliente.telefono}`} · {describirPeriodo(rango)}
        </p>
      )}

      <SelectorPeriodo rango={rango} onCambio={setRango} />
      <Aviso mensaje={mensaje ?? (estado.error ? { ok: false, texto: estado.error } : null)} />

      {d && (
        <>
          <div className="tabla-desplazable">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th className="concepto">Concepto</th>
                  <th>Cargo</th>
                  <th>Abono</th>
                  <th>Saldo</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{d.desde ? fecha(d.desde) : ''}</td>
                  <td className="concepto">Saldo anterior</td>
                  <td></td>
                  <td></td>
                  <td>{dinero(d.saldo_inicial, moneda)}</td>
                </tr>
                {filas.map((m, i) => (
                  <tr key={i}>
                    <td>{fecha(m.fecha)}</td>
                    <td className="concepto">{concepto(m, moneda)}</td>
                    <td>{m.cargo == null ? '' : dinero(m.cargo, moneda)}</td>
                    <td className="ok">{m.abono == null ? '' : dinero(m.abono, moneda)}</td>
                    <td>{dinero(m.saldo, moneda)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th></th>
                  <th className="concepto">Totales</th>
                  <th>{dinero(totalCargos, moneda)}</th>
                  <th>{dinero(totalAbonos, moneda)}</th>
                  <th></th>
                </tr>
              </tfoot>
            </table>
          </div>
          {filas.length === 0 && <p className="sub">Sin movimientos en este periodo.</p>}

          <div className="fila">
            <b>Saldo al {fecha(corte)}</b>
            <b className={`num grande-medio ${saldoFinal > 0 ? 'mala' : 'ok'}`}>{dinero(saldoFinal, moneda)}</b>
          </div>

          <div className="en-linea no-imprimir">
            <button className="secundario" onClick={() => window.print()}>
              Imprimir o PDF
            </button>
            <button className="secundario" onClick={() => void excel()}>
              Excel
            </button>
            <button className="secundario" onClick={() => void compartir()}>
              Compartir resumen
            </button>
          </div>
        </>
      )}
      {estado.cargando && <p className="sub">Cargando…</p>}
    </>
  )
}
