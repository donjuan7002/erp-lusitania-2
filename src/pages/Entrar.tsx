import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { supabase, enlaceInicial } from '../lib/supabase'
import { useSesion } from '../lib/sesion'
import { mensajeDeError } from '../lib/errores'
import { Cargando } from '../App'

export default function Entrar() {
  const { cargando, sesion } = useSesion()
  const ubicacion = useLocation()
  const [email, setEmail] = useState('')
  const [contrasena, setContrasena] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState(enlaceInicial.error ? mensajeDeError(enlaceInicial.error) : '')

  if (cargando) return <Cargando />
  if (sesion) {
    const desde = (ubicacion.state as { desde?: string } | null)?.desde ?? '/'
    return <Navigate to={desde} replace />
  }

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: contrasena })
    setEnviando(false)
    if (error) setError(mensajeDeError(error))
  }

  return (
    <main className="centrado">
      <h1>Trilla de café</h1>
      <p className="sub">Entra con tu correo y tu contraseña.</p>
      <form className="form" onSubmit={entrar}>
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
        <label htmlFor="contrasena">Contraseña</label>
        <input
          id="contrasena"
          type="password"
          autoComplete="current-password"
          required
          value={contrasena}
          onChange={(e) => setContrasena(e.target.value)}
        />
        {error && (
          <p className="aviso-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <p className="pie">
        <Link to="/recuperar">¿Olvidaste tu contraseña?</Link>
      </p>
      <p className="sub pie">Las cuentas las crea el administrador. Si no tienes una, pídesela.</p>
    </main>
  )
}
