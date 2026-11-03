import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useSesion } from '../lib/sesion'
import { mensajeDeError } from '../lib/errores'
import { nombreRol } from '../lib/permisos'
import { borrarDispositivo, leerDispositivo } from '../lib/dispositivo'
import { COLUMNAS_DISPOSITIVO, ListaDispositivos, type Dispositivo } from '../components/Dispositivos'
import { CodigosRecuperacion, InscribirTotp } from './DosPasos'
import { InstruccionesInstalar } from '../components/Instalar'
import { LARGO_MINIMO } from './DefinirContrasena'

type Mensaje = { ok: boolean; texto: string } | null

export default function Cuenta() {
  const { perfil, verificacion, recargarPerfil, recargarVerificacion, salir } = useSesion()
  const [nombre, setNombre] = useState(perfil?.nombre ?? '')
  const [contrasena, setContrasena] = useState('')
  const [mensaje, setMensaje] = useState<Mensaje>(null)
  const [ocupado, setOcupado] = useState(false)
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([])
  const [codigosNuevos, setCodigosNuevos] = useState<string[] | null>(null)
  const [cambiandoApp, setCambiandoApp] = useState(false)

  const idUsuario = perfil?.id
  const cargarDispositivos = useCallback(async () => {
    if (!idUsuario) return
    const { data } = await supabase
      .from('dispositivos_confiables')
      .select(COLUMNAS_DISPOSITIVO)
      .eq('usuario_id', idUsuario)
      .order('creado_en', { ascending: false })
    setDispositivos(data ?? [])
  }, [idUsuario])

  useEffect(() => {
    void cargarDispositivos()
  }, [cargarDispositivos])

  if (!perfil) return null
  const actual = leerDispositivo(perfil.id)?.id

  // Mientras se muestran códigos nuevos, no se ve nada más: no se repiten.
  if (codigosNuevos) {
    return (
      <CodigosRecuperacion
        codigos={codigosNuevos}
        onListo={() => {
          setCodigosNuevos(null)
          setCambiandoApp(false)
          void recargarVerificacion()
          void cargarDispositivos()
        }}
      />
    )
  }

  async function guardarNombre(e: FormEvent) {
    e.preventDefault()
    const limpio = nombre.trim()
    if (!limpio) return
    setOcupado(true)
    const { error } = await supabase.from('perfiles').update({ nombre: limpio }).eq('id', perfil!.id)
    setOcupado(false)
    setMensaje(error ? { ok: false, texto: mensajeDeError(error) } : { ok: true, texto: 'Nombre guardado.' })
    if (!error) await recargarPerfil()
  }

  async function cambiarContrasena(e: FormEvent) {
    e.preventDefault()
    if (contrasena.length < LARGO_MINIMO) {
      return setMensaje({ ok: false, texto: `Usa al menos ${LARGO_MINIMO} caracteres.` })
    }
    setOcupado(true)
    const { error } = await supabase.auth.updateUser({ password: contrasena })
    setOcupado(false)
    if (error) return setMensaje({ ok: false, texto: mensajeDeError(error) })
    setContrasena('')
    setMensaje({ ok: true, texto: 'Contraseña cambiada.' })
  }

  async function revocar(d: Dispositivo) {
    const esEste = d.id === actual
    const aviso = esEste
      ? 'Este es el equipo que estás usando. Al revocarlo tendrás que escribir un código para seguir. ¿Continuar?'
      : `¿Revocar «${d.nombre}»? La próxima vez que entre pedirá código.`
    if (!confirm(aviso)) return
    setOcupado(true)
    const { error } = await supabase.rpc('revocar_dispositivo', { dispositivo: d.id })
    setOcupado(false)
    if (error) return setMensaje({ ok: false, texto: mensajeDeError(error) })
    if (esEste) {
      borrarDispositivo(perfil!.id)
      await recargarVerificacion()
      return
    }
    setMensaje({ ok: true, texto: 'Dispositivo revocado.' })
    await cargarDispositivos()
  }

  async function regenerarCodigos() {
    if (!confirm('Los códigos anteriores dejarán de servir. ¿Generar códigos nuevos?')) return
    setOcupado(true)
    const { data, error } = await supabase.rpc('regenerar_codigos_recuperacion')
    setOcupado(false)
    if (error) return setMensaje({ ok: false, texto: mensajeDeError(error) })
    setCodigosNuevos(data as string[])
  }

  return (
    <>
      <h1>Mi cuenta</h1>
      <p className="sub">
        {perfil.email} · {nombreRol[perfil.rol]}
      </p>

      {mensaje && (
        <p className={mensaje.ok ? 'aviso-ok' : 'aviso-error'} role={mensaje.ok ? 'status' : 'alert'}>
          {mensaje.texto}
        </p>
      )}

      <h2>Nombre</h2>
      <form className="en-linea" onSubmit={guardarNombre}>
        <input aria-label="Nombre" value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} />
        <button type="submit" disabled={ocupado}>
          Guardar
        </button>
      </form>

      <h2>Cambiar contraseña</h2>
      <form className="en-linea" onSubmit={cambiarContrasena}>
        <input type="email" autoComplete="username" value={perfil.email} readOnly hidden />
        <input
          aria-label="Contraseña nueva"
          type="password"
          autoComplete="new-password"
          placeholder={`Nueva (mínimo ${LARGO_MINIMO})`}
          value={contrasena}
          onChange={(e) => setContrasena(e.target.value)}
        />
        <button type="submit" disabled={ocupado}>
          Cambiar
        </button>
      </form>

      <h2>Equipos de confianza</h2>
      <p className="sub">Desde estos equipos entras sin código. Revoca cualquiera que ya no uses o que hayas perdido.</p>
      <ListaDispositivos dispositivos={dispositivos} actual={actual} ocupado={ocupado} onRevocar={revocar} />

      <h2>Verificación en dos pasos</h2>
      <div className="fila">
        <span>
          Códigos de recuperación
          <small>Te quedan {verificacion?.codigos_restantes ?? 0} de 10.</small>
        </span>
        <button className="secundario ancho-auto" disabled={ocupado} onClick={() => void regenerarCodigos()}>
          Generar nuevos
        </button>
      </div>
      {cambiandoApp ? (
        <>
          <p className="sub">Configura la app nueva. La anterior dejará de servir cuando actives esta.</p>
          <InscribirTotp onConfirmado={setCodigosNuevos} />
          <button className="enlace" onClick={() => setCambiandoApp(false)}>
            Cancelar
          </button>
        </>
      ) : (
        <div className="fila">
          <span>
            App autenticadora
            <small>Cámbiala si estrenas celular.</small>
          </span>
          <button className="secundario ancho-auto" onClick={() => setCambiandoApp(true)}>
            Cambiar
          </button>
        </div>
      )}

      <h2 id="instalar">Instalar la app</h2>
      <InstruccionesInstalar />

      <h2>Sesión</h2>
      <button className="secundario" onClick={() => void salir()}>
        Salir
      </button>
      <p className="sub pie">Al salir, este equipo sigue siendo de confianza hasta que lo revoques.</p>
    </>
  )
}
