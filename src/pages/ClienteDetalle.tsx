import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { supabase } from '../lib/supabase'
import { useSesion } from '../lib/sesion'
import { puede } from '../lib/permisos'
import { mensajeDeError } from '../lib/errores'
import { listarPagos, listarRecibos, obtenerConfiguracion, useCarga, type Cliente, type Saldo } from '../lib/datos'
import { dinero, kg, porcentaje } from '../lib/formato'
import { Aviso, type Mensaje } from '../components/Aviso'
import { FilaRecibo } from '../components/FilaRecibo'
import { FilaPago } from '../components/FilaPago'

export default function ClienteDetalle() {
  const { id = '' } = useParams()
  const { perfil } = useSesion()
  const rol = perfil?.rol
  const verDinero = puede(rol, 'verDinero')
  const editarClientes = puede(rol, 'editarClientes')
  const registrar = puede(rol, 'registrarRecibos')
  const puedeAnular = puede(rol, 'anularRegistros')
  const [mensaje, setMensaje] = useState<Mensaje>(null)
  const [editando, setEditando] = useState(false)

  const cliente = useCarga(async () => {
    const { data, error } = await supabase
      .from('clientes')
      .select('id, nombre, telefono, notas, activo')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return data as Cliente | null
  }, [id])
  const saldo = useCarga(async () => {
    if (!verDinero) return null
    const { data, error } = await supabase.from('saldos_clientes').select('*').eq('cliente_id', id).maybeSingle()
    if (error) throw error
    return data as Saldo | null
  }, [id, verDinero])
  const recibos = useCarga(() => listarRecibos({ verDinero, clienteId: id, anulados: true, limite: 200 }), [id, verDinero])
  const pagos = useCarga(
    () => (verDinero ? listarPagos({ clienteId: id, anulados: true, limite: 200 }) : Promise.resolve([])),
    [id, verDinero],
  )
  const config = useCarga(() => (verDinero ? obtenerConfiguracion() : Promise.resolve(null)), [verDinero])
  const moneda = config.datos?.moneda ?? '$'

  if (cliente.cargando && !cliente.datos) return <p className="sub">Cargando…</p>
  if (!cliente.datos) {
    return (
      <>
        <h1>Cliente no encontrado</h1>
        <Link to="/clientes">← Volver a clientes</Link>
      </>
    )
  }
  const c = cliente.datos
  const vigentes = (recibos.datos ?? []).filter((r) => !r.anulado)
  const entregados = vigentes.filter((r) => r.kg_oro != null)
  const kgEntregado = entregados.reduce((s, r) => s + Number(r.kg_pergamino), 0)
  const kgOro = entregados.reduce((s, r) => s + Number(r.kg_oro), 0)
  const enProceso = vigentes.filter((r) => r.kg_oro == null).reduce((s, r) => s + Number(r.kg_pergamino), 0)

  function recargarMovimientos() {
    recibos.recargar()
    pagos.recargar()
    saldo.recargar()
  }

  return (
    <>
      <p className="sin-margen">
        <Link to="/clientes">← Clientes</Link>
      </p>
      <h1>
        {c.nombre} {!c.activo && <small className="etiqueta">inactivo</small>}
      </h1>
      <p className="sub">
        {c.telefono || 'Sin teléfono'}
        {c.notas && ` · ${c.notas}`}{' '}
        {editarClientes && !editando && (
          <button className="enlace" onClick={() => setEditando(true)}>
            Editar
          </button>
        )}
      </p>

      <Aviso mensaje={mensaje} />

      {editando && (
        <EditarCliente
          cliente={c}
          onCancelar={() => setEditando(false)}
          onListo={(m) => {
            setMensaje(m)
            if (m?.ok) {
              setEditando(false)
              cliente.recargar()
            }
          }}
        />
      )}

      <h2>Cuenta</h2>
      {verDinero && (
        <p className="sin-margen">
          <Link to={`/clientes/${c.id}/estado`}>Estado de cuenta imprimible →</Link>
        </p>
      )}
      {verDinero && saldo.datos && (
        <>
          <div className="fila">
            <span>Cobrado</span>
            <b className="num">{dinero(saldo.datos.cobrado, moneda)}</b>
          </div>
          <div className="fila">
            <span>Pagado</span>
            <b className="num">{dinero(saldo.datos.pagado, moneda)}</b>
          </div>
          <div className="fila">
            <b>Saldo</b>
            <b className={`num ${Number(saldo.datos.saldo) > 0 ? 'mala' : 'ok'}`}>{dinero(saldo.datos.saldo, moneda)}</b>
          </div>
        </>
      )}
      <div className="fila">
        <span>Café en proceso</span>
        <b className="num">{kg(enProceso)} pergamino</b>
      </div>
      <div className="fila">
        <span>Oro entregado</span>
        <b className="num">{kg(kgOro)}</b>
      </div>
      <div className="fila">
        <span>Rendimiento promedio</span>
        <b className="num">{porcentaje(kgEntregado ? (kgOro / kgEntregado) * 100 : null)}</b>
      </div>

      <h2>Recibos</h2>
      {recibos.datos?.length === 0 && <p className="sub">Sin recibos.</p>}
      {recibos.datos?.map((r) => (
        <FilaRecibo
          key={r.id}
          recibo={r}
          verDinero={verDinero}
          moneda={moneda}
          puedeEntregar={registrar}
          puedeAnular={puedeAnular}
          mostrarCliente={false}
          onCambio={recargarMovimientos}
          onMensaje={setMensaje}
        />
      ))}

      {verDinero && (
        <>
          <h2>Pagos</h2>
          {pagos.datos?.length === 0 && <p className="sub">Sin pagos.</p>}
          {pagos.datos?.map((p) => (
            <FilaPago
              key={p.id}
              pago={p}
              moneda={moneda}
              puedeAnular={puedeAnular}
              mostrarCliente={false}
              onCambio={recargarMovimientos}
              onMensaje={setMensaje}
            />
          ))}
        </>
      )}
    </>
  )
}

function EditarCliente(p: { cliente: Cliente; onCancelar: () => void; onListo: (m: Mensaje) => void }) {
  const [datos, setDatos] = useState({
    nombre: p.cliente.nombre,
    telefono: p.cliente.telefono ?? '',
    notas: p.cliente.notas ?? '',
    activo: p.cliente.activo,
  })
  const [enviando, setEnviando] = useState(false)

  async function guardar(e: FormEvent) {
    e.preventDefault()
    const nombre = datos.nombre.trim()
    if (!nombre) return p.onListo({ ok: false, texto: 'El nombre no puede quedar vacío.' })
    setEnviando(true)
    const { error } = await supabase
      .from('clientes')
      .update({ nombre, telefono: datos.telefono.trim() || null, notas: datos.notas.trim() || null, activo: datos.activo })
      .eq('id', p.cliente.id)
    setEnviando(false)
    p.onListo(error ? { ok: false, texto: mensajeDeError(error) } : { ok: true, texto: 'Cliente actualizado.' })
  }

  return (
    <form className="form" onSubmit={guardar}>
      <label htmlFor="ed-nombre">Nombre</label>
      <input id="ed-nombre" maxLength={120} value={datos.nombre} onChange={(e) => setDatos({ ...datos, nombre: e.target.value })} />
      <label htmlFor="ed-telefono">Teléfono</label>
      <input
        id="ed-telefono"
        type="tel"
        inputMode="tel"
        maxLength={30}
        value={datos.telefono}
        onChange={(e) => setDatos({ ...datos, telefono: e.target.value })}
      />
      <label htmlFor="ed-notas">Notas</label>
      <input id="ed-notas" maxLength={300} value={datos.notas} onChange={(e) => setDatos({ ...datos, notas: e.target.value })} />
      <label className="casilla">
        <input type="checkbox" checked={datos.activo} onChange={(e) => setDatos({ ...datos, activo: e.target.checked })} />
        Cliente activo (los inactivos no aparecen al registrar recibos ni pagos)
      </label>
      <div className="en-linea">
        <button type="submit" disabled={enviando}>
          Guardar
        </button>
        <button type="button" className="secundario" onClick={p.onCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
