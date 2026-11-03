import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useSesion } from '../lib/sesion'
import { mensajeDeError, mensajeDeFuncion } from '../lib/errores'
import { descripcionRol, nombreRol, ROLES, type Rol } from '../lib/permisos'
import { COLUMNAS_DISPOSITIVO, ListaDispositivos, type Dispositivo } from '../components/Dispositivos'

type Usuario = {
  id: string
  email: string
  nombre: string
  rol: Rol
  activo: boolean
  invitacion_pendiente: boolean
  ultimo_ingreso: string | null
}

async function llamar<T>(cuerpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-usuarios', { body: cuerpo })
  if (error) throw new Error(await mensajeDeFuncion(error))
  return data as T
}

const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }) : 'nunca'

export default function Usuarios() {
  const { perfil } = useSesion()
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [cupo, setCupo] = useState(15)
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null)
  const [nuevo, setNuevo] = useState({ nombre: '', email: '', rol: 'operador' as Rol })
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([])
  const [abierto, setAbierto] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const [r, d] = await Promise.all([
        llamar<{ cupo: number; usuarios: Usuario[] }>({ accion: 'listar' }),
        supabase.from('dispositivos_confiables').select(COLUMNAS_DISPOSITIVO).order('creado_en', { ascending: false }),
      ])
      if (d.error) throw d.error
      setUsuarios(r.usuarios)
      setCupo(r.cupo)
      setDispositivos(d.data ?? [])
    } catch (e) {
      setMensaje({ ok: false, texto: mensajeDeError(e) })
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const activos = usuarios.filter((u) => u.activo).length

  async function ejecutar(clave: string, accion: () => Promise<unknown>, exito: string) {
    setOcupado(clave)
    setMensaje(null)
    try {
      await accion()
      setMensaje({ ok: true, texto: exito })
      await cargar()
      return true
    } catch (e) {
      setMensaje({ ok: false, texto: mensajeDeError(e) })
      return false
    } finally {
      setOcupado(null)
    }
  }

  async function invitar(e: FormEvent) {
    e.preventDefault()
    const listo = await ejecutar(
      'invitar',
      () => llamar({ accion: 'invitar', ...nuevo }),
      `Invitación enviada a ${nuevo.email.trim()}.`,
    )
    if (listo) setNuevo({ nombre: '', email: '', rol: nuevo.rol })
  }

  function cambiarRol(u: Usuario, rol: Rol) {
    if (rol === u.rol) return
    if (!confirm(`¿Cambiar el rol de ${u.nombre || u.email} a ${nombreRol[rol]}?`)) return
    void ejecutar(u.id, () => llamar({ accion: 'actualizar', id: u.id, rol }), 'Rol actualizado.')
  }

  function cambiarEstado(u: Usuario) {
    const verbo = u.activo ? 'desactivar' : 'activar'
    if (!confirm(`¿Seguro que quieres ${verbo} a ${u.nombre || u.email}?`)) return
    void ejecutar(
      u.id,
      () => llamar({ accion: 'actualizar', id: u.id, activo: !u.activo }),
      u.activo ? 'Usuario desactivado. Ya no puede entrar.' : 'Usuario activado.',
    )
  }

  function revocar(u: Usuario, d: Dispositivo) {
    if (!confirm(`¿Revocar «${d.nombre}» de ${u.nombre || u.email}? Ese equipo pedirá código al volver a entrar.`)) return
    void ejecutar(
      u.id,
      async () => {
        const { error } = await supabase.rpc('revocar_dispositivo', { dispositivo: d.id })
        if (error) throw error
      },
      'Dispositivo revocado.',
    )
  }

  function restablecer(u: Usuario) {
    const aviso =
      `¿Restablecer la verificación en dos pasos de ${u.nombre || u.email}? ` +
      'Se borran su app autenticadora, sus códigos de recuperación y sus equipos de confianza. ' +
      'Al volver a entrar configurará una app nueva. Hazlo solo si confirmaste su identidad.'
    if (!confirm(aviso)) return
    void ejecutar(
      u.id,
      async () => {
        const { error } = await supabase.rpc('restablecer_dos_pasos', { usuario: u.id })
        if (error) throw error
      },
      'Verificación restablecida.',
    )
  }

  function enviarEnlace(u: Usuario) {
    void ejecutar(
      u.id,
      async () => {
        const { error } = await supabase.auth.resetPasswordForEmail(u.email, {
          redirectTo: `${window.location.origin}/definir-contrasena`,
        })
        if (error) throw error
      },
      `Enlace para crear contraseña enviado a ${u.email}.`,
    )
  }

  return (
    <>
      <h1>Usuarios</h1>
      <p className="sub">
        {activos} de {cupo} usuarios activos. Las cuentas solo se crean por invitación.
      </p>

      {mensaje && (
        <p className={mensaje.ok ? 'aviso-ok' : 'aviso-error'} role={mensaje.ok ? 'status' : 'alert'}>
          {mensaje.texto}
        </p>
      )}

      <h2>Invitar a una persona</h2>
      <form className="form" onSubmit={invitar}>
        <label htmlFor="nombre">Nombre</label>
        <input
          id="nombre"
          required
          maxLength={80}
          value={nuevo.nombre}
          onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
        />
        <label htmlFor="correo">Correo</label>
        <input
          id="correo"
          type="email"
          inputMode="email"
          required
          value={nuevo.email}
          onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })}
        />
        <label htmlFor="rol">Rol</label>
        <select id="rol" value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value as Rol })}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {nombreRol[r]}
            </option>
          ))}
        </select>
        <small className="sub">{descripcionRol[nuevo.rol]}</small>
        <button type="submit" disabled={ocupado === 'invitar' || activos >= cupo}>
          {ocupado === 'invitar' ? 'Enviando…' : activos >= cupo ? 'Cupo completo' : 'Enviar invitación'}
        </button>
      </form>

      <h2>Equipo</h2>
      {cargando ? (
        <p className="sub">Cargando…</p>
      ) : (
        usuarios.map((u) => {
          const soyYo = u.id === perfil?.id
          const suyos = dispositivos.filter((d) => d.usuario_id === u.id)
          const vigentes = suyos.filter((d) => !d.revocado_en && new Date(d.vence_en).getTime() > Date.now())
          return (
            <div key={u.id} className="fila bloque">
              <div className="fila-cabeza">
                <span>
                  {u.nombre || '(sin nombre)'} {soyYo && <small className="etiqueta">tú</small>}
                  <small>{u.email}</small>
                </span>
                <EstadoUsuario u={u} />
              </div>
              <small className="sub">Último ingreso: {fecha(u.ultimo_ingreso)}</small>
              <div className="en-linea">
                <select
                  aria-label={`Rol de ${u.nombre || u.email}`}
                  value={u.rol}
                  disabled={ocupado === u.id || soyYo}
                  onChange={(e) => cambiarRol(u, e.target.value as Rol)}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {nombreRol[r]}
                    </option>
                  ))}
                </select>
                {!soyYo && (
                  <button className="secundario" disabled={ocupado === u.id} onClick={() => cambiarEstado(u)}>
                    {u.activo ? 'Desactivar' : 'Activar'}
                  </button>
                )}
                {u.activo && (
                  <button className="secundario" disabled={ocupado === u.id} onClick={() => enviarEnlace(u)}>
                    {u.invitacion_pendiente ? 'Reenviar enlace' : 'Enlace de contraseña'}
                  </button>
                )}
                <button
                  className="secundario"
                  aria-expanded={abierto === u.id}
                  onClick={() => setAbierto(abierto === u.id ? null : u.id)}
                >
                  Equipos ({vigentes.length})
                </button>
              </div>
              {abierto === u.id && (
                <div className="tarjeta sin-margen-arriba">
                  <ListaDispositivos
                    dispositivos={suyos}
                    ocupado={ocupado === u.id}
                    onRevocar={(d) => revocar(u, d)}
                  />
                  {!soyYo && (
                    <button className="enlace" disabled={ocupado === u.id} onClick={() => restablecer(u)}>
                      Restablecer verificación en dos pasos (perdió el celular y los códigos)
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}
    </>
  )
}

function EstadoUsuario({ u }: { u: Usuario }) {
  if (!u.activo) return <small className="etiqueta mala">Desactivado</small>
  if (u.invitacion_pendiente) return <small className="etiqueta">Invitación pendiente</small>
  return <small className="etiqueta buena">Activo</small>
}
