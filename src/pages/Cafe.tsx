import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useSesion } from '../lib/sesion'
import { puede } from '../lib/permisos'
import { mensajeDeError } from '../lib/errores'
import { listarClientes, listarRecibos, obtenerConfiguracion, useCarga, type FiltroRecibos } from '../lib/datos'
import { hoy, kg, leerNumero } from '../lib/formato'
import { Aviso, type Mensaje } from '../components/Aviso'
import { FilaRecibo } from '../components/FilaRecibo'

type Filtro = Required<Pick<FiltroRecibos, 'estado' | 'anulados'>> & { clienteId: string; desde: string; hasta: string }

const PAGINA = 50

export default function Cafe() {
  const { perfil } = useSesion()
  const verDinero = puede(perfil?.rol, 'verDinero')
  const registrar = puede(perfil?.rol, 'registrarRecibos')
  const puedeAnular = puede(perfil?.rol, 'anularRegistros')

  const [mensaje, setMensaje] = useState<Mensaje>(null)
  const [filtro, setFiltro] = useState<Filtro>({ clienteId: '', desde: '', hasta: '', estado: 'todos', anulados: false })
  const [limite, setLimite] = useState(PAGINA)
  const [nuevo, setNuevo] = useState({ clienteId: '', kg: '', fecha: hoy() })
  const [enviando, setEnviando] = useState(false)

  const clientes = useCarga(() => listarClientes(), [])
  const config = useCarga(() => (verDinero ? obtenerConfiguracion() : Promise.resolve(null)), [verDinero])
  const recibos = useCarga(
    () =>
      listarRecibos({
        verDinero,
        clienteId: filtro.clienteId || undefined,
        desde: filtro.desde || undefined,
        hasta: filtro.hasta || undefined,
        estado: filtro.estado,
        anulados: filtro.anulados,
        limite,
      }),
    [verDinero, filtro, limite],
  )

  const activos = (clientes.datos ?? []).filter((c) => c.activo)
  const moneda = config.datos?.moneda ?? '$'

  async function registrarRecibo(e: FormEvent) {
    e.preventDefault()
    const kgPergamino = leerNumero(nuevo.kg)
    if (!nuevo.clienteId) return setMensaje({ ok: false, texto: 'Elige el cliente.' })
    if (!(kgPergamino > 0)) return setMensaje({ ok: false, texto: 'Escribe los kg de pergamino recibidos.' })
    setEnviando(true)
    // Sin .select(): el operador no puede leer la tabla de recibos (tiene precios).
    const { error } = await supabase
      .from('recibos')
      .insert({ cliente_id: nuevo.clienteId, kg_pergamino: kgPergamino, fecha: nuevo.fecha })
    setEnviando(false)
    if (error) return setMensaje({ ok: false, texto: mensajeDeError(error) })
    const nombre = activos.find((c) => c.id === nuevo.clienteId)?.nombre
    setMensaje({ ok: true, texto: `Recibo registrado: ${kg(kgPergamino)} de pergamino de ${nombre}.` })
    setNuevo({ ...nuevo, kg: '' })
    recibos.recargar()
  }

  const cambiarFiltro = (cambio: Partial<Filtro>) => {
    setFiltro({ ...filtro, ...cambio })
    setLimite(PAGINA)
  }

  return (
    <>
      <h1>Café recibido y entregado</h1>
      <p className="sub">
        {registrar ? 'Registra el pergamino que llega y el oro que sale.' : 'Consulta el café recibido y entregado.'}
      </p>

      <Aviso mensaje={mensaje} />

      {registrar && (
        <form className="form" onSubmit={registrarRecibo}>
          <label htmlFor="cliente">Cliente</label>
          <select id="cliente" value={nuevo.clienteId} onChange={(e) => setNuevo({ ...nuevo, clienteId: e.target.value })}>
            <option value="">Elige un cliente…</option>
            {activos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
          <label htmlFor="kg">Kilogramos de pergamino</label>
          <input
            id="kg"
            inputMode="decimal"
            autoComplete="off"
            value={nuevo.kg}
            onChange={(e) => setNuevo({ ...nuevo, kg: e.target.value })}
          />
          <label htmlFor="fecha">Fecha de recibo</label>
          <input
            id="fecha"
            type="date"
            max={hoy()}
            value={nuevo.fecha}
            onChange={(e) => setNuevo({ ...nuevo, fecha: e.target.value })}
          />
          <button type="submit" disabled={enviando}>
            {enviando ? 'Registrando…' : 'Registrar recibo'}
          </button>
          {activos.length === 0 && !clientes.cargando && (
            <small className="sub">Primero agrega clientes en la pestaña Clientes.</small>
          )}
        </form>
      )}

      <h2>Movimientos</h2>
      <div className="filtros">
        <select
          aria-label="Filtrar por cliente"
          value={filtro.clienteId}
          onChange={(e) => cambiarFiltro({ clienteId: e.target.value })}
        >
          <option value="">Todos los clientes</option>
          {(clientes.datos ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar por estado"
          value={filtro.estado}
          onChange={(e) => cambiarFiltro({ estado: e.target.value as Filtro['estado'] })}
        >
          <option value="todos">Todos</option>
          <option value="pendientes">En proceso</option>
          <option value="entregados">Entregados</option>
        </select>
        <label className="campo-fecha">
          Desde
          <input type="date" value={filtro.desde} onChange={(e) => cambiarFiltro({ desde: e.target.value })} />
        </label>
        <label className="campo-fecha">
          Hasta
          <input type="date" value={filtro.hasta} onChange={(e) => cambiarFiltro({ hasta: e.target.value })} />
        </label>
        <label className="casilla">
          <input type="checkbox" checked={filtro.anulados} onChange={(e) => cambiarFiltro({ anulados: e.target.checked })} />
          Mostrar anulados
        </label>
      </div>

      <Aviso mensaje={recibos.error ? { ok: false, texto: recibos.error } : null} />
      {recibos.datos?.length === 0 && <p className="sub">No hay movimientos con estos filtros.</p>}
      {recibos.datos?.map((r) => (
        <FilaRecibo
          key={r.id}
          recibo={r}
          verDinero={verDinero}
          moneda={moneda}
          puedeEntregar={registrar}
          puedeAnular={puedeAnular}
          onCambio={recibos.recargar}
          onMensaje={setMensaje}
        />
      ))}
      {recibos.datos?.length === limite && (
        <button className="secundario mas" onClick={() => setLimite(limite + PAGINA)}>
          Ver más
        </button>
      )}
      {recibos.cargando && <p className="sub">Cargando…</p>}
    </>
  )
}
