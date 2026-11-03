import { useSyncExternalStore } from 'react'

// Chrome y Edge (Windows, Mac, Android) avisan con «beforeinstallprompt»
// que la app se puede instalar. El evento llega una sola vez y muy pronto,
// por eso se escucha al cargar este módulo (lo importa main.tsx).
type EventoInstalacion = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let evento: EventoInstalacion | null = null
const oyentes = new Set<() => void>()
const avisar = () => oyentes.forEach((f) => f())

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  evento = e as EventoInstalacion
  avisar()
})
window.addEventListener('appinstalled', () => {
  evento = null
  avisar()
})

function suscribir(f: () => void) {
  oyentes.add(f)
  return () => oyentes.delete(f)
}

export type Plataforma = 'instalada' | 'boton' | 'ios' | 'safari-mac' | 'android' | 'firefox' | 'escritorio'

export function plataforma(hayEvento: boolean): Plataforma {
  const ua = navigator.userAgent
  const instalada =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  if (instalada) return 'instalada'
  if (hayEvento) return 'boton'
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  if (ios) return 'ios'
  if (/Android/.test(ua)) return 'android'
  if (/Firefox\//.test(ua)) return 'firefox'
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Edg|OPR/.test(ua)) return 'safari-mac'
  return 'escritorio'
}

export function useInstalacion() {
  const actual = useSyncExternalStore(suscribir, () => evento)
  return {
    plataforma: plataforma(!!actual),
    instalar: async () => {
      if (!actual) return false
      await actual.prompt()
      const { outcome } = await actual.userChoice
      evento = null
      avisar()
      return outcome === 'accepted'
    },
  }
}
