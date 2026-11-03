import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { useSesion } from '../lib/sesion'
import { puede, type Permiso } from '../lib/permisos'

type Pestana = { ruta: string; icono: string; texto: string; permisos?: Permiso[] }

const pestanas: Pestana[] = [
  { ruta: '/', icono: '📊', texto: 'Resumen' },
  { ruta: '/cafe', icono: '☕', texto: 'Café', permisos: ['registrarRecibos', 'verDinero'] },
  { ruta: '/clientes', icono: '👥', texto: 'Clientes' },
  { ruta: '/calculadora', icono: '🧮', texto: 'Calculadora' },
  { ruta: '/reportes', icono: '📋', texto: 'Reportes', permisos: ['verReportes'] },
]

export default function Marco({ children }: { children: ReactNode }) {
  const { perfil } = useSesion()
  const visibles = pestanas.filter((p) => !p.permisos || p.permisos.some((x) => puede(perfil?.rol, x)))

  return (
    <>
      <header className="cabecera">
        <NavLink to="/" className="marca">
          Trilla de café
        </NavLink>
        <nav className="cabecera-acciones" aria-label="Cuenta">
          {puede(perfil?.rol, 'gestionarUsuarios') && <NavLink to="/usuarios">Usuarios</NavLink>}
          <NavLink to="/cuenta" title={perfil?.email}>
            {perfil?.nombre.split(' ')[0] || 'Mi cuenta'}
          </NavLink>
        </nav>
      </header>
      <main>{children}</main>
      <nav className="pestanas" aria-label="Secciones">
        {visibles.map((p) => (
          <NavLink key={p.ruta} to={p.ruta} end={p.ruta === '/'}>
            <span aria-hidden="true">{p.icono}</span>
            {p.texto}
          </NavLink>
        ))}
      </nav>
    </>
  )
}
