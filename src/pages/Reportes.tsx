import { useState } from 'react'
import { Link } from 'react-router'
import { supabase } from '../lib/supabase'
import { useSesion } from '../lib/sesion'
import { puede } from '../lib/permisos'
import { mensajeDeError } from '../lib/errores'
import {
  METODOS_PAGO,
  obtenerConfiguracion,
  todasLasFilas,
  useCarga,
  type FilaReporte,
  type Pago,
  type Recibo,
} from '../lib/datos'
import { dinero, hoy, kg, num, porcentaje } from '../lib/formato'
import { exportarExcel, FORMATO_DINERO, FORMATO_PORCENTAJE, type Hoja } from '../lib/excel'
import { Aviso, type Mensaje } from '../components/Aviso'
import { describirPeriodo, periodo, SelectorPeriodo, type Rango } from '../components/Periodo'

const sumar = (filas: FilaReporte[], campo: keyof FilaReporte) => filas.reduce((s, f) => s + Number(f[campo] ?? 0), 0)
const generado = () => `Generado el ${new Date().toLocaleString('es', { dateStyle: 'long', timeStyle: 'short' })}`

export default function Reportes() {
  const { perfil } = useSesion()
  const esAdmin = puede(perfil?.rol, 'gestionarUsuarios')
  const [rango, setRango] = useState<Rango>(() => periodo('mes'))
  const [mensaje, setMensaje] = useState<Mensaje>(null)
  const [exportando, setExportando] = useState<string | null>(null)

  const config = useCarga(() => obtenerConfiguracion(), [])
  const reporte = useCarga(async () => {
    const { data, error } = await supabase.rpc('reporte_clientes', {
      desde: rango.desde || null,
      hasta: rango.hasta || null,
    })
    if (error) throw error
    return data as FilaReporte[]
  }, [rango])

  const filas = reporte.datos ?? []
  const moneda = config.datos?.moneda ?? '$'
  const negocio = config.datos?.nombre_negocio ?? 'Trilla de café'
  const t = {
    recibido: sumar(filas, 'kg_recibido'),
    entregado: sumar(filas, 'kg_entregado'),
    oro: sumar(filas, 'kg_oro'),
    cobrado: sumar(filas, 'cobrado'),
    pagado: sumar(filas, 'pagado'),
    saldo: sumar(filas, 'saldo'),
  }
  const rendimientoTotal = t.entregado ? (t.oro / t.entregado) * 100 : null
  const sufijo = rango.desde || rango.hasta ? `${rango.desde || 'inicio'}_a_${rango.hasta || hoy()}` : `historial_${hoy()}`

  async function exportar(clave: string, accion: () => Promise<void>) {
    setExportando(clave)
    setMensaje(null)
    try {
      await accion()
    } catch (e) {
      setMensaje({ ok: false, texto: `No se pudo exportar: ${mensajeDeError(e)}` })
    } finally {
      setExportando(null)
    }
  }

  const hojaReporte = (): Hoja => ({
    nombre: 'Por cliente',
    encabezado: [negocio, `Reporte por cliente · ${describirPeriodo(rango)}`, generado()],
    columnas: [
      { titulo: 'Cliente', ancho: 30 },
      { titulo: 'Recibido (kg pergamino)', ancho: 16 },
      { titulo: 'Entregado (kg pergamino)', ancho: 16 },
      { titulo: 'Oro (kg)', ancho: 12 },
      { titulo: 'Rendimiento', ancho: 12, formato: FORMATO_PORCENTAJE },
      { titulo: `Cobrado (${moneda})`, ancho: 16, formato: FORMATO_DINERO },
      { titulo: `Pagado (${moneda})`, ancho: 16, formato: FORMATO_DINERO },
      { titulo: `Saldo al corte (${moneda})`, ancho: 18, formato: FORMATO_DINERO },
    ],
    filas: filas.map((f) => [
      f.nombre,
      Number(f.kg_recibido),
      Number(f.kg_entregado),
      Number(f.kg_oro),
      f.rendimiento == null ? null : Number(f.rendimiento),
      Number(f.cobrado),
      Number(f.pagado),
      Number(f.saldo),
    ]),
    totales: ['Total', t.recibido, t.entregado, t.oro, rendimientoTotal, t.cobrado, t.pagado, t.saldo],
  })

  // Recibos (con su entrega) y pagos del periodo, uno por fila.
  async function hojasMovimientos(conAnulados: boolean, todoElHistorial: boolean): Promise<Hoja[]> {
    const desde = todoElHistorial ? '' : rango.desde
    const hasta = todoElHistorial ? '' : rango.hasta
    const recibos = await todasLasFilas<Recibo>((a, b) => {
      let q = supabase.from('recibos_detalle').select('*').order('fecha').order('creado_en').range(a, b)
      if (desde) q = q.gte('fecha', desde)
      if (hasta) q = q.lte('fecha', hasta)
      if (!conAnulados) q = q.eq('anulado', false)
      return q
    })
    const pagos = await todasLasFilas<Pago>((a, b) => {
      let q = supabase
        .from('pagos')
        .select('id, fecha, cliente_id, monto, metodo, notas, anulado, motivo_anulacion, clientes(nombre)')
        .order('fecha')
        .order('creado_en')
        .range(a, b)
      if (desde) q = q.gte('fecha', desde)
      if (hasta) q = q.lte('fecha', hasta)
      if (!conAnulados) q = q.eq('anulado', false)
      return q as unknown as PromiseLike<{ data: Pago[] | null; error: unknown }>
    })
    const estado = (anulado: boolean, motivo: string | null) => (anulado ? `Anulado: ${motivo ?? ''}` : 'Vigente')
    return [
      {
        nombre: 'Recibos',
        columnas: [
          { titulo: 'Fecha', ancho: 12 },
          { titulo: 'Cliente', ancho: 28 },
          { titulo: 'Kg pergamino', ancho: 14 },
          { titulo: `Tarifa (${moneda}/kg)`, ancho: 14, formato: FORMATO_DINERO },
          { titulo: `Cobro (${moneda})`, ancho: 16, formato: FORMATO_DINERO },
          { titulo: 'Fecha entrega', ancho: 12 },
          { titulo: 'Kg oro', ancho: 12 },
          { titulo: 'Rendimiento', ancho: 12, formato: FORMATO_PORCENTAJE },
          ...(conAnulados ? [{ titulo: 'Estado', ancho: 30 }] : []),
        ],
        filas: recibos.map((r) => [
          r.fecha,
          r.cliente_nombre,
          Number(r.kg_pergamino),
          Number(r.tarifa_aplicada),
          Number(r.cobro),
          r.fecha_entrega,
          r.kg_oro == null ? null : Number(r.kg_oro),
          r.rendimiento == null ? null : Number(r.rendimiento),
          ...(conAnulados ? [estado(r.anulado, r.motivo_anulacion)] : []),
        ]),
      },
      {
        nombre: 'Pagos',
        columnas: [
          { titulo: 'Fecha', ancho: 12 },
          { titulo: 'Cliente', ancho: 28 },
          { titulo: `Monto (${moneda})`, ancho: 16, formato: FORMATO_DINERO },
          { titulo: 'Método', ancho: 14 },
          { titulo: 'Notas', ancho: 30 },
          ...(conAnulados ? [{ titulo: 'Estado', ancho: 30 }] : []),
        ],
        filas: pagos.map((p) => [
          p.fecha,
          p.clientes?.nombre,
          Number(p.monto),
          METODOS_PAGO[p.metodo] ?? p.metodo,
          p.notas,
          ...(conAnulados ? [estado(p.anulado, p.motivo_anulacion)] : []),
        ]),
      },
    ]
  }

  async function copiaCompleta() {
    const clientes = await todasLasFilas<{ nombre: string; telefono: string | null; notas: string | null; activo: boolean }>(
      (a, b) => supabase.from('clientes').select('nombre, telefono, notas, activo').order('nombre').range(a, b),
    )
    const hojaClientes: Hoja = {
      nombre: 'Clientes',
      encabezado: [negocio, 'Copia de seguridad', generado()],
      columnas: [
        { titulo: 'Nombre', ancho: 30 },
        { titulo: 'Teléfono', ancho: 16 },
        { titulo: 'Notas', ancho: 40 },
        { titulo: 'Activo', ancho: 8 },
      ],
      filas: clientes.map((c) => [c.nombre, c.telefono, c.notas, c.activo ? 'Sí' : 'No']),
    }
    await exportarExcel(`copia-trilla-${hoy()}.xlsx`, [hojaClientes, ...(await hojasMovimientos(true, true))])
  }

  return (
    <>
      <div className="solo-imprimir">
        <p className="sin-margen">
          <b>{negocio}</b>
        </p>
        <p className="sub">{generado()}</p>
      </div>
      <h1>Reportes</h1>
      <p className="sub">Resumen por cliente · {describirPeriodo(rango)}</p>

      <SelectorPeriodo rango={rango} onCambio={setRango} />
      <Aviso mensaje={mensaje ?? (reporte.error ? { ok: false, texto: reporte.error } : null)} />

      <div className="tabla-desplazable">
        <table className="tabla">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Recibido</th>
              <th>Oro</th>
              <th>Rend.</th>
              <th>Cobrado</th>
              <th>Pagado</th>
              <th>Saldo</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.cliente_id}>
                <td>
                  <Link to={`/clientes/${f.cliente_id}`}>{f.nombre}</Link>
                </td>
                <td>{num(f.kg_recibido)}</td>
                <td>{num(f.kg_oro)}</td>
                <td>{porcentaje(f.rendimiento)}</td>
                <td>{dinero(f.cobrado, moneda)}</td>
                <td>{dinero(f.pagado, moneda)}</td>
                <td className={Number(f.saldo) > 0 ? 'mala' : ''}>{dinero(f.saldo, moneda)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>Total</th>
              <th>{num(t.recibido)}</th>
              <th>{num(t.oro)}</th>
              <th>{porcentaje(rendimientoTotal)}</th>
              <th>{dinero(t.cobrado, moneda)}</th>
              <th>{dinero(t.pagado, moneda)}</th>
              <th>{dinero(t.saldo, moneda)}</th>
            </tr>
          </tfoot>
        </table>
      </div>
      {reporte.cargando && <p className="sub">Cargando…</p>}
      <p className="sub">
        Recibido, oro y cobrado: recibos con fecha en el periodo (en kg de pergamino y de oro). Pagado: pagos del
        periodo. Saldo: deuda total del cliente a la fecha final.
      </p>
      {t.recibido > t.entregado && (
        <p className="sub">
          {kg(t.recibido - t.entregado)} de pergamino del periodo siguen en proceso; el rendimiento solo cuenta lo ya
          entregado.
        </p>
      )}

      <h2 className="no-imprimir">Exportar</h2>
      <div className="en-linea no-imprimir">
        <button
          className="secundario"
          disabled={!!exportando || !filas.length}
          onClick={() => void exportar('reporte', () => exportarExcel(`reporte-clientes-${sufijo}.xlsx`, [hojaReporte()]))}
        >
          {exportando === 'reporte' ? 'Generando…' : 'Excel'}
        </button>
        <button className="secundario" onClick={() => window.print()}>
          Imprimir o PDF
        </button>
        <button
          className="secundario"
          disabled={!!exportando}
          onClick={() =>
            void exportar('movimientos', async () =>
              exportarExcel(`movimientos-${sufijo}.xlsx`, await hojasMovimientos(false, false)),
            )
          }
        >
          {exportando === 'movimientos' ? 'Generando…' : 'Movimientos del periodo (Excel)'}
        </button>
      </div>
      {esAdmin && (
        <div className="tarjeta no-imprimir">
          <p className="sin-margen">
            <b>Copia de seguridad</b>
          </p>
          <p className="sub">
            Todos los clientes, recibos y pagos, incluidos los anulados, en un archivo de Excel. Descárgala cada mes y
            guárdala fuera de este equipo.
          </p>
          <button className="secundario" disabled={!!exportando} onClick={() => void exportar('copia', copiaCompleta)}>
            {exportando === 'copia' ? 'Generando…' : 'Descargar copia completa'}
          </button>
        </div>
      )}
      <p className="sub no-imprimir">
        Para guardar en PDF, elige «Imprimir o PDF» y en el destino selecciona «Guardar como PDF».
      </p>
    </>
  )
}
