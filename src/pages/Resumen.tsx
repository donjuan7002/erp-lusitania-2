import { Link } from 'react-router'
import { supabase } from '../lib/supabase'
import { useSesion } from '../lib/sesion'
import { descripcionRol, nombreRol, puede } from '../lib/permisos'
import { listarRecibos, obtenerConfiguracion, useCarga, type Resumen as DatosResumen } from '../lib/datos'
import { dinero, fecha, kg, num, porcentaje } from '../lib/formato'
import { Aviso } from '../components/Aviso'
import { BannerInstalar } from '../components/Instalar'

export default function Resumen() {
  const { perfil, verificacion } = useSesion()
  const verDinero = puede(perfil?.rol, 'verDinero')

  const resumen = useCarga(async () => {
    const { data, error } = await supabase.rpc('resumen')
    if (error) throw error
    return data as DatosResumen
  }, [])
  const config = useCarga(() => (verDinero ? obtenerConfiguracion() : Promise.resolve(null)), [verDinero])
  const pendientes = useCarga(() => listarRecibos({ verDinero, estado: 'pendientes', limite: 20 }), [verDinero])

  if (!perfil) return null
  const r = resumen.datos
  const moneda = config.datos?.moneda ?? '$'
  const recibido = Number(r?.kg_recibido ?? 0)
  const trillado = Number(r?.kg_pergamino_trillado ?? 0)
  const porCobrar = Number(r?.por_cobrar ?? 0)

  return (
    <>
      <h1>Hola, {perfil.nombre.split(' ')[0] || perfil.email}</h1>
      <p className="sub">
        {nombreRol[perfil.rol]}. {descripcionRol[perfil.rol]}
      </p>

      {verificacion && verificacion.codigos_restantes < 3 && (
        <p className="aviso-error" role="status">
          Te quedan {verificacion.codigos_restantes} códigos de recuperación. <Link to="/cuenta">Genera nuevos</Link> y,
          si perdiste tu app autenticadora, configúrala de nuevo en Mi cuenta.
        </p>
      )}
      <Aviso mensaje={resumen.error ? { ok: false, texto: resumen.error } : null} />
      <BannerInstalar />

      {r && (
        <>
          {verDinero && (
            <>
              <div className="sub sin-margen">Por cobrar</div>
              <div className={`grande ${porCobrar > 0 ? 'mala' : ''}`}>{dinero(porCobrar, moneda)}</div>
            </>
          )}
          <div className="barra" aria-hidden="true">
            <i style={{ width: `${recibido ? (trillado / recibido) * 100 : 0}%` }} />
          </div>
          <p className="sub">
            {num(trillado)} kg de pergamino ya trillados de {num(recibido)} recibidos
          </p>
          <div className="fila">
            <span>Café en proceso</span>
            <b className="num">{kg(r.kg_en_proceso)} pergamino</b>
          </div>
          <div className="fila">
            <span>Entregado</span>
            <b className="num">{kg(r.kg_oro)} oro</b>
          </div>
          <div className="fila">
            <span>Rendimiento promedio</span>
            <b className="num">{porcentaje(r.rendimiento)}</b>
          </div>
          {verDinero && config.datos && (
            <div className="fila">
              <span>Tarifa vigente</span>
              <b className="num">{dinero(config.datos.tarifa_kg, moneda)} por kg</b>
            </div>
          )}
        </>
      )}

      <h2>Pendientes de entrega{r ? ` (${r.lotes_pendientes})` : ''}</h2>
      {pendientes.datos?.length === 0 && (
        <p className="sub">
          No hay café pendiente.
          {puede(perfil.rol, 'registrarRecibos') && (
            <>
              {' '}
              Registra un recibo en la pestaña <Link to="/cafe">Café</Link>.
            </>
          )}
        </p>
      )}
      {pendientes.datos?.map((p) => (
        <div key={p.id} className="fila">
          <span>
            {p.cliente_nombre}
            <small>{fecha(p.fecha)}</small>
          </span>
          <b className="num">{kg(p.kg_pergamino)}</b>
        </div>
      ))}
      {r && Number(r.lotes_pendientes) > (pendientes.datos?.length ?? 0) && (
        <p className="pie">
          <Link to="/cafe">Ver todos en Café →</Link>
        </p>
      )}

      {puede(perfil.rol, 'gestionarUsuarios') && (
        <p className="pie">
          <Link to="/usuarios">Invitar y gestionar usuarios →</Link>
        </p>
      )}
    </>
  )
}
