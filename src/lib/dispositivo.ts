// Token del dispositivo confiable. Lo genera el servidor y solo sirve junto
// con la contraseña de su dueño; el servidor decide si sigue vigente.
// Se guarda por usuario por si varias personas comparten un equipo.
type TokenLocal = { token: string; id: string | null }

const clave = (usuario: string) => `trilla.dispositivo.${usuario}`

export function leerDispositivo(usuario: string): TokenLocal | null {
  try {
    const valor = JSON.parse(localStorage.getItem(clave(usuario)) ?? 'null')
    return typeof valor?.token === 'string' ? valor : null
  } catch {
    return null
  }
}

export function guardarDispositivo(usuario: string, token: string, id: string | null) {
  try {
    localStorage.setItem(clave(usuario), JSON.stringify({ token, id }))
  } catch {
    // Sin almacenamiento (modo privado): este equipo pedirá código cada vez.
  }
}

export function borrarDispositivo(usuario: string) {
  try {
    localStorage.removeItem(clave(usuario))
  } catch {
    // nada que borrar
  }
}

// Nombre legible para reconocer el equipo en la lista, p. ej. «Chrome en Android».
export function nombreDispositivo(): string {
  const ua = navigator.userAgent
  const sistema = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Macintosh|Mac OS X/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Dispositivo'
  const navegador = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\/|FxiOS/.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS/.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : ''
  const instalada = window.matchMedia?.('(display-mode: standalone)').matches
  return `${navegador ? `${navegador} en ` : ''}${sistema}${instalada ? ' (app instalada)' : ''}`
}
