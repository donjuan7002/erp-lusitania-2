import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { enlaceInicial, supabase } from '../lib/supabase'
import { useSesion } from '../lib/sesion'
import { mensajeDeError } from '../lib/errores'
import { Cargando } from '../App'

export const LARGO_MINIMO = 10

// Pantalla a la que llegan los enlaces de invitación y de recuperación.
export default function DefinirContrasena() {
  const { cargando, sesion, contrasenaDefinida } = useSesion()
  const navegar = useNavigate()
  const [contrasena, setContrasena] = useState('')
  const [repetida, setRepetida] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  if (cargando) return <Cargando />

  if (!sesion) {
    return (
      <main className="centrado">
        <h1>Enlace no válido</h1>
        <p className="aviso-error" role="alert">
          {enlaceInicial.error
            ? mensajeDeError(enlaceInicial.error)
            : 'Abre esta página desde el enlace que te llegó por correo.'}
        </p>
        <p className="sub">
          Si eras un usuario invitado, pide al administrador que te envíe un enlace nuevo. Si olvidaste tu
          contraseña, puedes <Link to="/recuperar">pedir otro enlace</Link>.
        </p>
      </main>
    )
  }

  const esInvitacion = enlaceInicial.tipo === 'invite'

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (contrasena.length < LARGO_MINIMO) return setError(`Usa al menos ${LARGO_MINIMO} caracteres.`)
    if (contrasena !== repetida) return setError('Las dos contraseñas no coinciden.')
    setEnviando(true)
    const { error } = await supabase.auth.updateUser({ password: contrasena })
    setEnviando(false)
    if (error) return setError(mensajeDeError(error))
    contrasenaDefinida()
    navegar('/', { replace: true })
  }

  return (
    <main className="centrado">
      <h1>{esInvitacion ? 'Bienvenido' : 'Nueva contraseña'}</h1>
      <p className="sub">
        {esInvitacion ? 'Crea la contraseña de tu cuenta' : 'Elige una contraseña nueva'} ({sesion.user.email}).
      </p>
      <form className="form" onSubmit={guardar}>
        <input type="email" autoComplete="username" value={sesion.user.email ?? ''} readOnly hidden />
        <label htmlFor="nueva">Contraseña (mínimo {LARGO_MINIMO} caracteres)</label>
        <input
          id="nueva"
          type="password"
          autoComplete="new-password"
          required
          minLength={LARGO_MINIMO}
          value={contrasena}
          onChange={(e) => setContrasena(e.target.value)}
        />
        <label htmlFor="repetida">Repite la contraseña</label>
        <input
          id="repetida"
          type="password"
          autoComplete="new-password"
          required
          value={repetida}
          onChange={(e) => setRepetida(e.target.value)}
        />
        {error && (
          <p className="aviso-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={enviando}>
          {enviando ? 'Guardando…' : 'Guardar contraseña'}
        </button>
      </form>
    </main>
  )
}
