import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Sin la URL y la clave pública, la app compilada solo mostraría
// «Falta configurar Supabase». Se detiene la compilación de producción para
// no publicar una versión rota. También se rechaza una clave secreta por
// error: todo lo que empieza por VITE_ termina dentro del navegador.
function revisarVariables(mode: string) {
  const env = loadEnv(mode, '.', 'VITE_')
  const url = env.VITE_SUPABASE_URL
  const clave = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''
  if (mode === 'production' && (!url || !clave)) {
    throw new Error(
      'Faltan VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY. Defínelas en .env.local (o en el servicio de publicación) antes de compilar.',
    )
  }
  let rolDelJwt = ''
  try {
    const carga = (clave.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/')
    rolDelJwt = JSON.parse(atob(carga)).role ?? ''
  } catch {
    // No es un JWT (las claves nuevas sb_publishable_… no lo son).
  }
  if (clave.startsWith('sb_secret_') || rolDelJwt === 'service_role') {
    throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY contiene la clave SECRETA. Usa la clave pública (publishable o anon).')
  }
}

export default defineConfig(({ command, mode }) => {
  if (command === 'build') revisarVariables(mode)
  return {
    plugins: [
      react(),
      VitePWA({
        // La app avisa que hay versión nueva y la persona decide cuándo
        // actualizar, para no recargar la página a mitad de un registro.
        registerType: 'prompt',
        includeAssets: ['favicon.ico', 'icono.svg', 'apple-touch-icon-180x180.png'],
        manifest: {
          id: '/',
          name: 'Trilla de café',
          short_name: 'Trilla',
          description: 'Gestión de la trilla de café: recibos, entregas, clientes y pagos.',
          lang: 'es',
          dir: 'ltr',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'any',
          background_color: '#eef1ea',
          theme_color: '#1f5c3f',
          categories: ['business', 'productivity'],
          icons: [
            { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // Solo se guarda en caché la app; los datos siempre vienen de Supabase.
          globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
          navigateFallback: '/index.html',
        },
      }),
    ],
  }
})
