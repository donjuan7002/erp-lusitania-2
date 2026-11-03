import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { supabase } from '../lib/supabase'
import { useSesion } from '../lib/sesion'
import { puede } from '../lib/permisos'
import { mensajeDeError } from '../lib/errores'
import {
  listarClientes,
  listarPagos,
  listarSaldos,
  METODOS_PAGO,
  obtenerConfiguracion,
  useCarga,
} from '../lib/datos'
import { dinero, hoy, leerNumero } from '../lib/formato'
import { Aviso, type Mensaje } from '../components/Aviso'
import { FilaPago } from '../components/FilaPago'

export default function Clientes() {
  const { perfil } = useSesion()
  const rol = perfil?.rol
  const verDinero = puede(rol, 'verDinero')
  const registrarPagos = puede(rol, 'registrarPagos')
  const editarClientes = puede(rol, 'editarClientes')
  const cambiarTarifas = puede(rol, 'cambiarTarifas')
  const puedeAnular = puede(rol, 'anularRegistros')

  const [mensaje, setMensaje] = useState<Mensaje>(null)
  const [busqueda, setBusqueda] = useState('')
  const [verInactivos, setVerInactivos] = useState(false)

  const clientes = useCarga(() => listarClientes(), [])
  const saldos = useCarga(() => (verDinero ? listarSaldos() : Promise.resolve([])), [verDinero])
  const pagos = useCarga(() => (verDinero ? listarPagos({ limite: 10 }) : Promise.resolve([])), [verDinero])
  const config = useCarga(() => (verDinero ? obtenerConfiguracion() : Promise.resolve(null)), [verDinero])
  const moneda = config.datos?.moneda ?? '$'

  const saldoPorCliente = new Map((saldos.datos ?? []).map((s) => [s.cliente_id, s]))
  const texto = busqueda.trim().toLowerCase()
  const visibles = (clientes.datos ?? []).filter(
    (c) => (verInactivos || c.activo) && (!texto || c.nombre.toLowerCase().includes(texto)),
  )
  const totalPorCobrar = (saldos.datos ?? []).reduce((suma, s) => suma + Number(s.saldo), 0)

  function recargarTodo() {
    clientes.recargar()
    saldos.recargar()
    pagos.recargar()
  }

  return (
    <>
      <h1>Clientes y cuentas</h1>
      {verDinero && config.datos && (
        <Tarifa
          tarifa={config.datos.tarifa_kg}
          moneda={moneda}
          negocio={config.datos.nombre_negocio}
          editable={cambiarTarifas}
          onGuardado={() => {
            config.recargar()
            setMensaje({ ok: true, texto: 'Tarifa actualizada. Se aplica a los recibos nuevos; los anteriores conservan la suya.' })
          }}
          onError={(texto) => setMensaje({ ok: false, texto })}
        />
      )}

      <Aviso mensaje={mensaje} />

      {registrarPagos && (
        <FormPago
          clientes={(clientes.datos ?? []).filter((c) => c.activo)}
          moneda={moneda}
          onListo={(m) => {
            setMensaje(m)
            if (m?.ok) recargarTodo()
          }}
        />
      )}

      <h2>{verDinero ? 'Saldos' : 'Clientes'}</h2>
      <div className="filtros">
        <input
          type="search"
          aria-label="Buscar cliente"
          placeholder="Buscar cliente…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <label className="casilla">
          <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} />
          Mostrar inactivos
        </label>
      </div>
      {verDinero && saldos.datos && (
        <div className="fila">
          <b>Total por cobrar</b>
          <b className={`num ${totalPorCobrar > 0 ? 'mala' : 'ok'}`}>{dinero(totalPorCobrar, moneda)}</b>
        </div>
      )}
      {visibles.map((c) => {
        const s = saldoPorCliente.get(c.id)
        return (
          <Link key={c.id} to={`/clientes/${c.id}`} className="fila enlace-fila">
            <span>
              {c.nombre} {!c.activo && <small className="etiqueta">inactivo</small>}
              <small>
                {verDinero && s
                  ? `Cobrado ${dinero(s.cobrado, moneda)}, pagado ${dinero(s.pagado, moneda)}`
                  : c.telefono || 'Sin teléfono'}
              </small>
            </span>
            {verDinero && s ? (
              <b className={`num ${Number(s.saldo) > 0 ? 'mala' : 'ok'}`}>{dinero(s.saldo, moneda)}</b>
            ) : (
              <span aria-hidden="true">›</span>
            )}
          </Link>
        )
      })}
      {clientes.datos && visibles.length === 0 && <p className="sub">No hay clientes que coincidan.</p>}
      {clientes.cargando && <p className="sub">Cargando…</p>}

      {editarClientes && (
        <NuevoCliente
          existentes={(clientes.datos ?? []).map((c) => c.nombre.toLowerCase())}
          onListo={(m) => {
            setMensaje(m)
            if (m?.ok) recargarTodo()
          }}
        />
      )}

      {verDinero && (
        <>
          <h2>Pagos recientes</h2>
          {pagos.datos?.length === 0 && <p className="sub">Aún no hay pagos.</p>}
          {pagos.datos?.map((p) => (
            <FilaPago
              key={p.id}
              pago={p}
              moneda={moneda}
              puedeAnular={puedeAnular}
              onCambio={recargarTodo}
              onMensaje={setMensaje}
            />
          ))}
        </>
      )}
    </>
  )
}

function Tarifa(p: {
  tarifa: number
  moneda: string
  negocio: string
  editable: boolean
  onGuardado: () => void
  onError: (texto: string) => void
}) {
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState(String(p.tarifa))
  const [moneda, setMoneda] = useState(p.moneda)
  const [negocio, setNegocio] = useState(p.negocio)

  async function guardar(e: FormEvent) {
    e.preventDefault()
    const tarifa = leerNumero(valor)
    if (!(tarifa >= 0)) return p.onError('Escribe una tarifa válida.')
    if (!confirm(`¿Cambiar la tarifa a ${dinero(tarifa, moneda)} por kg? Solo afecta a los recibos nuevos.`)) return
    const { error } = await supabase
      .from('configuracion')
      .update({ tarifa_kg: tarifa, moneda: moneda.trim() || '$', nombre_negocio: negocio.trim() || 'Trilla de café' })
      .eq('id', 1)
    if (error) return p.onError(mensajeDeError(error))
    setEditando(false)
    p.onGuardado()
  }

  if (editando) {
    return (
      <form className="form" onSubmit={guardar}>
        <label htmlFor="tarifa">Tarifa por kg de pergamino</label>
        <input id="tarifa" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
        <label htmlFor="moneda">Símbolo de moneda</label>
        <input id="moneda" maxLength={5} value={moneda} onChange={(e) => setMoneda(e.target.value)} />
        <label htmlFor="negocio">Nombre del negocio (encabeza reportes y estados de cuenta)</label>
        <input id="negocio" maxLength={80} value={negocio} onChange={(e) => setNegocio(e.target.value)} />
        <div className="en-linea">
          <button type="submit">Guardar tarifa</button>
          <button type="button" className="secundario" onClick={() => setEditando(false)}>
            Cancelar
          </button>
        </div>
      </form>
    )
  }
  return (
    <p className="sub">
      Cobro actual: {dinero(p.tarifa, p.moneda)} por kilogramo de pergamino.{' '}
      {p.editable && (
        <button className="enlace" onClick={() => setEditando(true)}>
          Cambiar tarifa
        </button>
      )}
    </p>
  )
}

function FormPago(p: { clientes: { id: string; nombre: string }[]; moneda: string; onListo: (m: Mensaje) => void }) {
  const [datos, setDatos] = useState({ clienteId: '', monto: '', metodo: 'efectivo', fecha: hoy(), notas: '' })
  const [enviando, setEnviando] = useState(false)

  async function registrar(e: FormEvent) {
    e.preventDefault()
    const monto = leerNumero(datos.monto)
    if (!datos.clienteId) return p.onListo({ ok: false, texto: 'Elige el cliente que paga.' })
    if (!(monto > 0)) return p.onListo({ ok: false, texto: 'Escribe el monto del pago.' })
    setEnviando(true)
    const { error } = await supabase.from('pagos').insert({
      cliente_id: datos.clienteId,
      monto,
      metodo: datos.metodo,
      fecha: datos.fecha,
      notas: datos.notas.trim() || null,
    })
    setEnviando(false)
    if (error) return p.onListo({ ok: false, texto: mensajeDeError(error) })
    const nombre = p.clientes.find((c) => c.id === datos.clienteId)?.nombre
    p.onListo({ ok: true, texto: `Pago de ${dinero(monto, p.moneda)} registrado para ${nombre}.` })
    setDatos({ ...datos, monto: '', notas: '' })
  }

  return (
    <form className="form" onSubmit={registrar}>
      <label htmlFor="pago-cliente">Registrar pago de</label>
      <select id="pago-cliente" value={datos.clienteId} onChange={(e) => setDatos({ ...datos, clienteId: e.target.value })}>
        <option value="">Elige un cliente…</option>
        {p.clientes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </select>
      <label htmlFor="pago-monto">Monto</label>
      <input id="pago-monto" inputMode="decimal" value={datos.monto} onChange={(e) => setDatos({ ...datos, monto: e.target.value })} />
      <div className="dos-columnas">
        <div>
          <label htmlFor="pago-metodo">Método</label>
          <select id="pago-metodo" value={datos.metodo} onChange={(e) => setDatos({ ...datos, metodo: e.target.value })}>
            {Object.entries(METODOS_PAGO).map(([valor, texto]) => (
              <option key={valor} value={valor}>
                {texto}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pago-fecha">Fecha</label>
          <input
            id="pago-fecha"
            type="date"
            max={hoy()}
            value={datos.fecha}
            onChange={(e) => setDatos({ ...datos, fecha: e.target.value })}
          />
        </div>
      </div>
      <label htmlFor="pago-notas">Notas (opcional)</label>
      <input id="pago-notas" maxLength={200} value={datos.notas} onChange={(e) => setDatos({ ...datos, notas: e.target.value })} />
      <button type="submit" disabled={enviando}>
        {enviando ? 'Registrando…' : 'Registrar pago'}
      </button>
    </form>
  )
}

function NuevoCliente(p: { existentes: string[]; onListo: (m: Mensaje) => void }) {
  const [datos, setDatos] = useState({ nombre: '', telefono: '', notas: '' })
  const [enviando, setEnviando] = useState(false)

  async function agregar(e: FormEvent) {
    e.preventDefault()
    const nombre = datos.nombre.trim()
    if (!nombre) return p.onListo({ ok: false, texto: 'Escribe el nombre del cliente.' })
    if (p.existentes.includes(nombre.toLowerCase()) && !confirm(`Ya existe un cliente llamado «${nombre}». ¿Agregarlo igual?`)) return
    setEnviando(true)
    const { error } = await supabase
      .from('clientes')
      .insert({ nombre, telefono: datos.telefono.trim() || null, notas: datos.notas.trim() || null })
    setEnviando(false)
    if (error) return p.onListo({ ok: false, texto: mensajeDeError(error) })
    p.onListo({ ok: true, texto: `Cliente «${nombre}» agregado.` })
    setDatos({ nombre: '', telefono: '', notas: '' })
  }

  return (
    <>
      <h2>Nuevo cliente</h2>
      <form className="form" onSubmit={agregar}>
        <label htmlFor="cli-nombre">Nombre</label>
        <input id="cli-nombre" maxLength={120} value={datos.nombre} onChange={(e) => setDatos({ ...datos, nombre: e.target.value })} />
        <label htmlFor="cli-telefono">Teléfono (opcional)</label>
        <input
          id="cli-telefono"
          type="tel"
          inputMode="tel"
          maxLength={30}
          value={datos.telefono}
          onChange={(e) => setDatos({ ...datos, telefono: e.target.value })}
        />
        <label htmlFor="cli-notas">Notas (opcional)</label>
        <input id="cli-notas" maxLength={300} value={datos.notas} onChange={(e) => setDatos({ ...datos, notas: e.target.value })} />
        <button type="submit" disabled={enviando}>
          {enviando ? 'Agregando…' : 'Agregar cliente'}
        </button>
      </form>
    </>
  )
}
