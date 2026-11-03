import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

const UNA_HORA = 60 * 60 * 1000

// Avisos fijos en la parte de abajo: versión nueva disponible y sin conexión.
export default function AvisosApp() {
  const {
    needRefresh: [hayVersionNueva],
    updateServiceWorker,
  } = useRegisterSW({
    // La app puede quedar abierta todo el día: se buscan versiones nuevas cada hora.
    onRegisteredSW(_url, registro) {
      if (registro) setInterval(() => void registro.update(), UNA_HORA)
    },
  })
  const [enLinea, setEnLinea] = useState(navigator.onLine)

  useEffect(() => {
    const conectar = () => setEnLinea(true)
    const desconectar = () => setEnLinea(false)
    window.addEventListener('online', conectar)
    window.addEventListener('offline', desconectar)
    return () => {
      window.removeEventListener('online', conectar)
      window.removeEventListener('offline', desconectar)
    }
  }, [])

  if (!enLinea) {
    return (
      <div className="aviso-flotante mala-fondo no-imprimir" role="status">
        Sin conexión a internet. Puedes consultar lo que ya estaba en pantalla, pero no se guardará nada hasta que
        vuelva la conexión.
      </div>
    )
  }
  if (hayVersionNueva) {
    return (
      <div className="aviso-flotante no-imprimir" role="status">
        <span>Hay una versión nueva de la app.</span>
        <button className="ancho-auto" onClick={() => void updateServiceWorker(true)}>
          Actualizar
        </button>
      </div>
    )
  }
  return null
}
