import { FunctionsHttpError } from '@supabase/supabase-js'

// Mensajes de Supabase Auth en inglés → español para el usuario.
const traducciones: [RegExp, string][] = [
  [/invalid login credentials/i, 'Correo o contraseña incorrectos.'],
  [/email not confirmed/i, 'Aún no has aceptado la invitación. Revisa tu correo.'],
  [/user is banned|banned/i, 'Tu cuenta está desactivada. Habla con el administrador.'],
  [/should be different from the old password/i, 'La nueva contraseña debe ser distinta de la anterior.'],
  [/password should be at least/i, 'La contraseña es demasiado corta.'],
  [/weak password|password is known to be weak/i, 'Esa contraseña es muy fácil de adivinar. Elige otra.'],
  [/rate limit|too many requests|security purposes/i, 'Demasiados intentos. Espera unos minutos y vuelve a probar.'],
  [/email link is invalid or has expired|otp_expired/i, 'El enlace venció o ya se usó. Pide uno nuevo.'],
  [/auth session missing|jwt expired/i, 'Tu sesión venció. Vuelve a entrar.'],
  [/failed to fetch|network/i, 'Sin conexión con el servidor. Revisa tu internet.'],
  [/row-level security|permission denied/i, 'Tu rol no tiene permiso para hacer esto.'],
  [/entregas_una_vigente_por_recibo/i, 'Este recibo ya tiene una entrega registrada.'],
]

export function mensajeDeError(e: unknown): string {
  // Los errores de la base de datos (PostgrestError) traen message aunque no
  // siempre sean instancias de Error.
  const texto =
    typeof e === 'string'
      ? e
      : e && typeof e === 'object' && 'message' in e
        ? String((e as { message: unknown }).message)
        : ''
  for (const [patron, mensaje] of traducciones) if (patron.test(texto)) return mensaje
  return texto || 'Ocurrió un error inesperado.'
}

// Las funciones del servidor responden { error } con un mensaje ya en español.
export async function mensajeDeFuncion(e: unknown): Promise<string> {
  if (e instanceof FunctionsHttpError) {
    try {
      const cuerpo = await e.context.json()
      if (cuerpo?.error) return String(cuerpo.error)
    } catch {
      // cuerpo no JSON: se usa el mensaje genérico
    }
  }
  return mensajeDeError(e)
}
