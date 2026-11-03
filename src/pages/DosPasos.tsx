import { useState, type FormEvent } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'
import { useSesion } from '../lib/sesion'
import { mensajeDeError } from '../lib/errores'
import { guardarDispositivo, nombreDispositivo } from '../lib/dispositivo'

type Resultado = {
  ok: boolean
  mensaje?: string
  bloqueado_hasta?: string | null
  token_dispositivo?: string | null
  dispositivo_id?: string | null
  codigos_recuperacion?: string[]
}

const EMISOR = 'Trilla de café'
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es', { timeStyle: 'short' })

// Pantalla que aparece al entrar desde un dispositivo no confiable.
export default function DosPasos() {
  const { verificacion, salir, recargarVerificacion } = useSesion()
  const [codigos, setCodigos] = useState<string[] | null>(null)

  if (codigos) {
    return (
      <main className="centrado">
        <CodigosRecuperacion codigos={codigos} onListo={() => void recargarVerificacion()} />
      </main>
    )
  }

  return (
    <main className="centrado">
      {verificacion?.tiene_factor ? (
        <VerificarIdentidad />
      ) : (
        <>
          <h1>Protege tu cuenta</h1>
          <p className="sub">
            Para entrar desde equipos nuevos usarás un código de una app autenticadora en tu celular, además de tu
            contraseña.
          </p>
          <InscribirTotp onConfirmado={setCodigos} />
        </>
      )}
      <p className="pie">
        <button className="enlace" onClick={() => void salir()}>
          Salir
        </button>
      </p>
    </main>
  )
}

function VerificarIdentidad() {
  const { perfil, verificacion, recargarVerificacion } = useSesion()
  const [modo, setModo] = useState<'totp' | 'recuperacion'>('totp')
  const [codigo, setCodigo] = useState('')
  const [recordar, setRecordar] = useState(true)
  const [nombre, setNombre] = useState(nombreDispositivo)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const bloqueo = verificacion?.bloqueado_hasta

  async function verificar(e: FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setError('')
    const { data, error } = await supabase.rpc(modo === 'totp' ? 'verificar_totp' : 'usar_codigo_recuperacion', {
      codigo,
      recordar,
      nombre_dispositivo: nombre,
    })
    setEnviando(false)
    if (error) return setError(mensajeDeError(error))
    const r = data as Resultado
    if (!r.ok) {
      setCodigo('')
      setError(r.mensaje ?? 'Código incorrecto.')
      if (r.bloqueado_hasta) await recargarVerificacion()
      return
    }
    if (r.token_dispositivo && perfil) guardarDispositivo(perfil.id, r.token_dispositivo, r.dispositivo_id ?? null)
    await recargarVerificacion()
  }

  return (
    <>
      <h1>Verifica que eres tú</h1>
      <p className="sub">
        Es la primera vez que entras desde este equipo, o ya no es de confianza.{' '}
        {modo === 'totp'
          ? 'Escribe el código de 6 dígitos de tu app autenticadora.'
          : 'Escribe uno de tus códigos de recuperación. Cada código sirve una sola vez.'}
      </p>
      {bloqueo ? (
        <p className="aviso-error" role="alert">
          Demasiados intentos fallidos. Podrás volver a intentarlo a las {hora(bloqueo)}.
        </p>
      ) : (
        <form className="form" onSubmit={verificar}>
          <label htmlFor="codigo">{modo === 'totp' ? 'Código de la app' : 'Código de recuperación'}</label>
          {modo === 'totp' ? (
            <input
              id="codigo"
              className="codigo"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
            />
          ) : (
            <input
              id="codigo"
              className="codigo"
              autoComplete="off"
              autoCapitalize="characters"
              placeholder="XXXXX-XXXXX"
              required
              autoFocus
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
            />
          )}
          <OpcionRecordar recordar={recordar} setRecordar={setRecordar} nombre={nombre} setNombre={setNombre} />
          {error && (
            <p className="aviso-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={enviando}>
            {enviando ? 'Verificando…' : 'Verificar'}
          </button>
        </form>
      )}
      <p className="pie">
        <button
          className="enlace"
          onClick={() => {
            setModo(modo === 'totp' ? 'recuperacion' : 'totp')
            setCodigo('')
            setError('')
          }}
        >
          {modo === 'totp' ? '¿Perdiste tu app autenticadora? Usa un código de recuperación' : 'Usar la app autenticadora'}
        </button>
      </p>
      {modo === 'recuperacion' && (
        <p className="sub">Si tampoco tienes códigos, pide al administrador que restablezca tu verificación.</p>
      )}
    </>
  )
}

function OpcionRecordar(p: {
  recordar: boolean
  setRecordar: (v: boolean) => void
  nombre: string
  setNombre: (v: string) => void
}) {
  return (
    <>
      <label className="casilla">
        <input type="checkbox" checked={p.recordar} onChange={(e) => p.setRecordar(e.target.checked)} />
        Confiar en este equipo 90 días (no lo marques en equipos ajenos o públicos)
      </label>
      {p.recordar && (
        <>
          <label htmlFor="nombre-equipo">Nombre de este equipo</label>
          <input id="nombre-equipo" maxLength={80} value={p.nombre} onChange={(e) => p.setNombre(e.target.value)} />
        </>
      )}
    </>
  )
}

// Configura (o cambia) la app autenticadora. La usan esta pantalla y Mi cuenta.
export function InscribirTotp({ onConfirmado }: { onConfirmado: (codigos: string[]) => void }) {
  const { perfil, recargarVerificacion } = useSesion()
  const [datos, setDatos] = useState<{ secreto: string; qr: string; uri: string } | null>(null)
  const [codigo, setCodigo] = useState('')
  const [recordar, setRecordar] = useState(true)
  const [nombre, setNombre] = useState(nombreDispositivo)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')

  async function empezar() {
    setOcupado(true)
    setError('')
    const { data, error } = await supabase.rpc('iniciar_inscripcion_totp')
    if (error) {
      setOcupado(false)
      return setError(mensajeDeError(error))
    }
    const { secreto, email } = data as { secreto: string; email: string }
    const uri =
      `otpauth://totp/${encodeURIComponent(EMISOR)}:${encodeURIComponent(email)}` +
      `?secret=${secreto}&issuer=${encodeURIComponent(EMISOR)}&algorithm=SHA1&digits=6&period=30`
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 240 })
    setDatos({ secreto, qr, uri })
    setOcupado(false)
  }

  async function confirmar(e: FormEvent) {
    e.preventDefault()
    setOcupado(true)
    setError('')
    const { data, error } = await supabase.rpc('confirmar_inscripcion_totp', {
      codigo,
      recordar,
      nombre_dispositivo: nombre,
    })
    setOcupado(false)
    if (error) return setError(mensajeDeError(error))
    const r = data as Resultado
    if (!r.ok) {
      setCodigo('')
      setError(r.mensaje ?? 'Código incorrecto.')
      if (r.bloqueado_hasta) await recargarVerificacion()
      return
    }
    if (r.token_dispositivo && perfil) guardarDispositivo(perfil.id, r.token_dispositivo, r.dispositivo_id ?? null)
    onConfirmado(r.codigos_recuperacion ?? [])
  }

  if (!datos) {
    return (
      <div className="form">
        <p className="sin-margen">
          <b>1.</b> Instala en tu celular una app autenticadora gratuita: Google Authenticator, Microsoft Authenticator
          u otra que prefieras.
        </p>
        {error && (
          <p className="aviso-error" role="alert">
            {error}
          </p>
        )}
        <button onClick={() => void empezar()} disabled={ocupado}>
          {ocupado ? 'Preparando…' : 'Ya la tengo, continuar'}
        </button>
      </div>
    )
  }

  return (
    <form className="form" onSubmit={confirmar}>
      <p className="sin-margen">
        <b>2.</b> En la app, elige «Agregar cuenta» y escanea este código.
      </p>
      <img className="qr" src={datos.qr} alt="Código QR para la app autenticadora" width={240} height={240} />
      <details>
        <summary>¿Estás en el celular o no puedes escanear?</summary>
        <p className="sub">
          <a href={datos.uri}>Abrir en la app autenticadora</a>, o escribe esta clave a mano:
        </p>
        <code className="clave">{datos.secreto.match(/.{1,4}/g)?.join(' ')}</code>
      </details>
      <label htmlFor="codigo-nuevo">
        <b>3.</b> Escribe el código de 6 dígitos que muestra la app
      </label>
      <input
        id="codigo-nuevo"
        className="codigo"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        value={codigo}
        onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
      />
      <OpcionRecordar recordar={recordar} setRecordar={setRecordar} nombre={nombre} setNombre={setNombre} />
      {error && (
        <p className="aviso-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={ocupado}>
        {ocupado ? 'Comprobando…' : 'Activar'}
      </button>
    </form>
  )
}

export function CodigosRecuperacion({ codigos, onListo }: { codigos: string[]; onListo: () => void }) {
  const [guardados, setGuardados] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const texto = `Códigos de recuperación de ${EMISOR}\nCada código sirve una sola vez.\n\n${codigos.join('\n')}\n`

  function descargar() {
    const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: 'codigos-recuperacion-trilla.txt' })
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <h1>Guarda tus códigos de recuperación</h1>
      <p className="sub">
        Si pierdes el celular o la app autenticadora, podrás entrar con uno de estos códigos. Cada uno sirve una sola
        vez y no se volverán a mostrar.
      </p>
      <ol className="codigos">
        {codigos.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ol>
      <div className="en-linea">
        <button className="secundario" onClick={descargar}>
          Descargar
        </button>
        <button
          className="secundario"
          onClick={() => {
            void navigator.clipboard?.writeText(texto).then(() => setCopiado(true))
          }}
        >
          {copiado ? 'Copiados' : 'Copiar'}
        </button>
      </div>
      <label className="casilla">
        <input type="checkbox" checked={guardados} onChange={(e) => setGuardados(e.target.checked)} />
        Los guardé en un lugar seguro, fuera de este celular
      </label>
      <button disabled={!guardados} onClick={onListo}>
        Continuar
      </button>
    </>
  )
}
