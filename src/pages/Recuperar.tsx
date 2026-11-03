import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { supabase } from '../lib/supabase'
import { mensajeDeError } from '../lib/errores'

export default function Recuperar() {
  const [email, setEmail] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [error, setError] = useState('')

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setError('')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/definir-contrasena`,
    })
    setEnviando(false)
    // Por seguridad no se dice si el correo existe o no.
    if (error && /rate limit|security purposes/i.test(error.message)) setError(mensajeDeError(error))
    else setEnviado(true)
  }

  return (
    <main className="centrado">
      <h1>Recuperar contraseña</h1>
      {enviado ? (
        <p className="aviso-ok" role="status">
          Si el correo pertenece a una cuenta, te llegará un enlace para crear una contraseña nueva. Revisa también
          la carpeta de spam.
        </p>
      ) : (
        <>
          <p className="sub">Te enviaremos un enlace a tu correo.</p>
          <form className="form" onSubmit={enviar}>
            <label htmlFor="email">Correo</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {error && (
              <p className="aviso-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" disabled={enviando}>
              {enviando ? 'Enviando…' : 'Enviar enlace'}
            </button>
          </form>
        </>
      )}
      <p className="pie">
        <Link to="/entrar">Volver a entrar</Link>
      </p>
    </main>
  )
}
