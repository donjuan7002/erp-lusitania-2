import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Genera los iconos de la app (Android, iPhone, Windows y Mac) a partir del SVG.
// Uso: npm run iconos
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#1f5c3f' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#1f5c3f' } },
  },
  images: ['public/icono.svg'],
})
