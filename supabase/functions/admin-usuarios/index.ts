// Función del servidor para que el administrador invite y gestione usuarios.
// Usa la clave secreta (service_role), que solo existe aquí y nunca llega al
// navegador. Los cambios de perfil se hacen con la sesión del propio
// administrador, para que las reglas por fila y la auditoría registren quién.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const ROLES = ['admin', 'operador', 'consulta'] as const
type Rol = (typeof ROLES)[number]
const CUPO = 15

// Direcciones de la app que pueden llamar a esta función, separadas por comas
// (secreto ORIGENES_PERMITIDOS). Sin configurar, se acepta cualquiera: la
// función igual exige la sesión de un administrador verificado.
const permitidos = (Deno.env.get('ORIGENES_PERMITIDOS') ?? '')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean)

const origenValido = (origen: string | null) =>
  permitidos.length === 0 ? origen : origen && permitidos.includes(origen) ? origen : null

let cors: Record<string, string> = {}

function respuesta(cuerpo: unknown, estado = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
const error = (mensaje: string, estado = 400) => respuesta({ error: mensaje }, estado)

const esCorreo = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
const esRol = (v: unknown): v is Rol => ROLES.includes(v as Rol)
const limpiarNombre = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 80) : '')

Deno.serve(async (req) => {
  const origen = origenValido(req.headers.get('origin'))
  cors = {
    'Access-Control-Allow-Origin': permitidos.length === 0 ? '*' : (origen ?? permitidos[0]),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (permitidos.length > 0 && !origen) return error('Origen no permitido', 403)
  if (req.method !== 'POST') return error('Método no permitido', 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const claveAnonima = Deno.env.get('SUPABASE_ANON_KEY')!
  const claveSecreta = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const autorizacion = req.headers.get('Authorization') ?? ''
  if (!autorizacion.startsWith('Bearer ')) return error('Sesión requerida', 401)

  // Cliente con la sesión del usuario que llama: respeta las reglas por fila.
  const comoUsuario = createClient(url, claveAnonima, {
    global: { headers: { Authorization: autorizacion } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: sesion, error: errSesion } = await comoUsuario.auth.getUser(autorizacion.slice(7))
  if (errSesion || !sesion.user) return error('Sesión inválida o vencida', 401)
  const { data: rol } = await comoUsuario.rpc('rol_actual')
  if (rol !== 'admin') return error('Solo el administrador puede gestionar usuarios', 403)

  // Cliente con la clave secreta: solo para la API de administración de Auth.
  const servidor = createClient(url, claveSecreta, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let datos: Record<string, unknown>
  try {
    datos = await req.json()
  } catch {
    return error('Petición inválida')
  }

  switch (datos.accion) {
    case 'listar': {
      const { data: perfiles, error: e1 } = await comoUsuario
        .from('perfiles')
        .select('id, email, nombre, rol, activo, creado_en')
        .order('nombre')
      if (e1) return error(e1.message, 500)
      const { data: lista, error: e2 } = await servidor.auth.admin.listUsers({ perPage: 200 })
      if (e2) return error(e2.message, 500)
      const porId = new Map(lista.users.map((u) => [u.id, u]))
      return respuesta({
        cupo: CUPO,
        usuarios: perfiles.map((p) => {
          const u = porId.get(p.id)
          return {
            ...p,
            invitacion_pendiente: !u?.email_confirmed_at,
            ultimo_ingreso: u?.last_sign_in_at ?? null,
          }
        }),
      })
    }

    case 'invitar': {
      const email = typeof datos.email === 'string' ? datos.email.trim().toLowerCase() : ''
      const nombre = limpiarNombre(datos.nombre)
      if (!esCorreo(email)) return error('Correo no válido')
      if (!nombre) return error('Escribe el nombre de la persona')
      if (!esRol(datos.rol)) return error('Rol no válido')

      const { count } = await comoUsuario
        .from('perfiles')
        .select('id', { count: 'exact', head: true })
        .eq('activo', true)
      if ((count ?? 0) >= CUPO) return error(`Ya hay ${CUPO} usuarios activos. Desactiva uno para invitar a otro.`, 409)

      // El enlace del correo vuelve a la app, a la pantalla de crear contraseña.
      // Supabase solo acepta direcciones de su lista de URL de redirección.
      const { data: invitado, error: e1 } = await servidor.auth.admin.inviteUserByEmail(email, {
        data: { nombre },
        redirectTo: origen ? `${origen}/definir-contrasena` : undefined,
      })
      if (e1) {
        const yaExiste = /already|registered|exists/i.test(e1.message)
        return error(yaExiste ? 'Ya existe un usuario con ese correo' : e1.message, yaExiste ? 409 : 500)
      }

      const { error: e2 } = await comoUsuario
        .from('perfiles')
        .update({ nombre, rol: datos.rol, activo: true })
        .eq('id', invitado.user.id)
      if (e2) {
        // Deshacer: no dejar un usuario a medias.
        await servidor.auth.admin.deleteUser(invitado.user.id)
        return error(e2.message, 409)
      }
      return respuesta({ ok: true, id: invitado.user.id })
    }

    case 'actualizar': {
      const id = typeof datos.id === 'string' ? datos.id : ''
      if (!id) return error('Falta el usuario')
      const cambios: Record<string, unknown> = {}
      if (datos.rol !== undefined) {
        if (!esRol(datos.rol)) return error('Rol no válido')
        cambios.rol = datos.rol
      }
      if (datos.nombre !== undefined) {
        const nombre = limpiarNombre(datos.nombre)
        if (!nombre) return error('El nombre no puede quedar vacío')
        cambios.nombre = nombre
      }
      if (datos.activo !== undefined) {
        if (typeof datos.activo !== 'boolean') return error('Estado no válido')
        if (id === sesion.user.id && !datos.activo) return error('No puedes desactivar tu propia cuenta')
        cambios.activo = datos.activo
      }
      if (Object.keys(cambios).length === 0) return error('No hay cambios')

      // Las reglas de la base de datos validan el cupo y el último administrador.
      const { data: fila, error: e1 } = await comoUsuario
        .from('perfiles')
        .update(cambios)
        .eq('id', id)
        .select('id')
        .maybeSingle()
      if (e1) return error(e1.message, 409)
      if (!fila) return error('Usuario no encontrado', 404)

      // Un usuario desactivado tampoco puede iniciar sesión ni renovar la suya.
      if (cambios.activo !== undefined) {
        const { error: e2 } = await servidor.auth.admin.updateUserById(id, {
          ban_duration: cambios.activo ? 'none' : '876000h',
        })
        if (e2) return error(`Perfil actualizado, pero no se pudo cambiar el acceso: ${e2.message}`, 500)
      }
      return respuesta({ ok: true })
    }

    default:
      return error('Acción desconocida')
  }
})
