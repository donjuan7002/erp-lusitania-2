import { createClient } from '@supabase/supabase-js'

// Antes de crear el cliente (que consume el fragmento de la URL) se anota si
// la página se abrió desde un enlace de invitación o de recuperación, o si
// el enlace llegó con un error (por ejemplo, vencido).
const fragmento = new URLSearchParams(window.location.hash.slice(1))
const consulta = new URLSearchParams(window.location.search)
export const enlaceInicial = {
  tipo: fragmento.get('type'),
  error: fragmento.get('error_description') ?? consulta.get('error_description'),
}

const url = import.meta.env.VITE_SUPABASE_URL
const clavePublica = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const configurado = Boolean(url && clavePublica)

// Solo se usa la clave pública. La clave secreta vive en la función del
// servidor (supabase/functions/admin-usuarios) y nunca llega aquí.
export const supabase = createClient(url || 'http://localhost', clavePublica || 'sin-configurar', {
  auth: {
    // Las invitaciones las inicia el servidor, así que el enlace del correo
    // no puede usar PKCE (no hay verificador guardado en este navegador).
    flowType: 'implicit',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
