import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { enlaceInicial, supabase } from './supabase'
import { borrarDispositivo, leerDispositivo } from './dispositivo'
import type { Rol } from './permisos'

export type Perfil = {
  id: string
  email: string
  nombre: string
  rol: Rol
  activo: boolean
}

// Estado de la verificación en dos pasos de la sesión actual, según el servidor.
export type Verificacion = {
  verificada: boolean
  tiene_factor: boolean
  bloqueado_hasta: string | null
  codigos_restantes: number
}

type EstadoSesion = {
  cargando: boolean
  sesion: Session | null
  perfil: Perfil | null
  verificacion: Verificacion | null
  // La persona llegó desde una invitación o un enlace de recuperación y
  // todavía no ha elegido su contraseña.
  debeDefinirContrasena: boolean
  contrasenaDefinida: () => void
  recargarPerfil: () => Promise<void>
  recargarVerificacion: () => Promise<void>
  salir: () => Promise<void>
}

const Contexto = createContext<EstadoSesion | null>(null)

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Session | null>(null)
  const [sesionLista, setSesionLista] = useState(false)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [verificacion, setVerificacion] = useState<Verificacion | null>(null)
  const [datosListos, setDatosListos] = useState(false)
  const [debeDefinirContrasena, setDebeDefinir] = useState(
    enlaceInicial.tipo === 'invite' || enlaceInicial.tipo === 'recovery',
  )

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSesion(data.session)
      setSesionLista(true)
    })
    const { data } = supabase.auth.onAuthStateChange((evento, nueva) => {
      setSesion(nueva)
      if (evento === 'PASSWORD_RECOVERY') setDebeDefinir(true)
      if (evento === 'SIGNED_OUT') setDebeDefinir(false)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const idUsuario = sesion?.user.id

  const cargarPerfil = useCallback(async () => {
    if (!idUsuario) return setPerfil(null)
    const { data } = await supabase
      .from('perfiles')
      .select('id, email, nombre, rol, activo')
      .eq('id', idUsuario)
      .maybeSingle()
    setPerfil(data)
  }, [idUsuario])

  // Pregunta al servidor si esta sesión ya está verificada. Si no lo está y
  // este equipo guarda un token de dispositivo confiable, lo presenta: el
  // servidor decide si sigue valiendo (no revocado, no vencido, del usuario).
  const cargarVerificacion = useCallback(async () => {
    if (!idUsuario) return setVerificacion(null)
    let { data } = await supabase.rpc('estado_verificacion')
    const local = leerDispositivo(idUsuario)
    if (data && !data.verificada && !data.bloqueado_hasta && local) {
      const { data: id, error } = await supabase.rpc('usar_dispositivo', { token: local.token })
      if (id) ({ data } = await supabase.rpc('estado_verificacion'))
      else if (!error) borrarDispositivo(idUsuario)
    }
    setVerificacion(data as Verificacion | null)
  }, [idUsuario])

  useEffect(() => {
    let vigente = true
    setDatosListos(false)
    Promise.all([cargarPerfil(), cargarVerificacion()]).finally(() => {
      if (vigente) setDatosListos(true)
    })
    return () => {
      vigente = false
    }
  }, [cargarPerfil, cargarVerificacion])

  const salir = useCallback(async () => {
    // El token del dispositivo se conserva: el equipo sigue siendo confiable.
    await supabase.auth.signOut()
    setPerfil(null)
    setVerificacion(null)
  }, [])

  return (
    <Contexto.Provider
      value={{
        cargando: !sesionLista || (!!idUsuario && !datosListos),
        sesion,
        perfil,
        verificacion,
        debeDefinirContrasena,
        contrasenaDefinida: () => setDebeDefinir(false),
        recargarPerfil: cargarPerfil,
        recargarVerificacion: cargarVerificacion,
        salir,
      }}
    >
      {children}
    </Contexto.Provider>
  )
}

export function useSesion() {
  const valor = useContext(Contexto)
  if (!valor) throw new Error('useSesion debe usarse dentro de ProveedorSesion')
  return valor
}
