import { useState } from 'react'
import { Link } from 'react-router'
import { useInstalacion, type Plataforma } from '../lib/instalacion'

const CLAVE_OCULTAR = 'trilla.ocultarInstalar'

const pasos: Record<Exclude<Plataforma, 'instalada' | 'boton'>, string> = {
  ios: 'En Safari, toca el botón Compartir (el cuadrado con la flecha hacia arriba) y elige «Agregar a pantalla de inicio».',
  'safari-mac': 'En Safari, abre el menú Archivo y elige «Agregar al Dock».',
  android: 'Abre el menú ⋮ del navegador y elige «Instalar aplicación» o «Agregar a pantalla de inicio».',
  firefox: 'Firefox en computador no instala aplicaciones. Abre esta dirección en Chrome o Edge para instalarla.',
  escritorio:
    'En Chrome o Edge, pulsa el icono de instalar que aparece a la derecha de la barra de direcciones, o abre el menú y elige «Instalar Trilla de café».',
}

// Explica cómo instalar la app en el equipo actual (Mi cuenta).
export function InstruccionesInstalar() {
  const { plataforma, instalar } = useInstalacion()
  const [resultado, setResultado] = useState('')

  if (plataforma === 'instalada') return <p className="sub">Ya estás usando la app instalada en este equipo.</p>
  if (plataforma === 'boton') {
    return (
      <>
        <p className="sub">Instálala para abrirla como una app, con su propio icono y sin la barra del navegador.</p>
        <button
          className="secundario"
          onClick={() => void instalar().then((ok) => setResultado(ok ? '¡Listo! Ya puedes abrirla desde su icono.' : ''))}
        >
          Instalar en este equipo
        </button>
        {resultado && <p className="aviso-ok">{resultado}</p>}
      </>
    )
  }
  return <p className="sub">{pasos[plataforma]}</p>
}

// Invitación discreta en el Resumen; se puede cerrar y no vuelve a salir.
export function BannerInstalar() {
  const { plataforma } = useInstalacion()
  const [oculto, setOculto] = useState(() => {
    try {
      return localStorage.getItem(CLAVE_OCULTAR) === '1'
    } catch {
      return false
    }
  })
  if (oculto || plataforma === 'instalada' || plataforma === 'firefox') return null

  function cerrar() {
    setOculto(true)
    try {
      localStorage.setItem(CLAVE_OCULTAR, '1')
    } catch {
      // sin almacenamiento: volverá a salir la próxima vez
    }
  }

  return (
    <div className="tarjeta banner">
      <span>
        Instala la app en este equipo para abrirla desde su icono. <Link to="/cuenta#instalar">Cómo instalarla</Link>
      </span>
      <button className="enlace" aria-label="Cerrar aviso de instalación" onClick={cerrar}>
        ✕
      </button>
    </div>
  )
}
