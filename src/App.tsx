import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router'
import { ProveedorSesion, useSesion } from './lib/sesion'
import { configurado } from './lib/supabase'
import { puede, type Permiso } from './lib/permisos'
import Marco from './components/Marco'
import AvisosApp from './components/AvisosApp'
import Entrar from './pages/Entrar'
import Recuperar from './pages/Recuperar'
import DefinirContrasena from './pages/DefinirContrasena'
import Resumen from './pages/Resumen'
import Usuarios from './pages/Usuarios'
import Cuenta from './pages/Cuenta'
import DosPasos from './pages/DosPasos'
import Cafe from './pages/Cafe'
import Clientes from './pages/Clientes'
import ClienteDetalle from './pages/ClienteDetalle'
import EstadoCuenta from './pages/EstadoCuenta'
import Calculadora from './pages/Calculadora'
import Reportes from './pages/Reportes'

export default function App() {
  if (!configurado) return <FaltaConfiguracion />
  return (
    <ProveedorSesion>
      <AvisosApp />
      <BrowserRouter>
        <Routes>
          <Route path="/entrar" element={<Entrar />} />
          <Route path="/recuperar" element={<Recuperar />} />
          <Route path="/definir-contrasena" element={<DefinirContrasena />} />
          <Route element={<ConSesion />}>
            <Route index element={<Resumen />} />
            <Route
              path="cafe"
              element={
                <ConPermiso permiso="registrarRecibos" tambien="verDinero">
                  <Cafe />
                </ConPermiso>
              }
            />
            <Route path="clientes" element={<Clientes />} />
            <Route path="clientes/:id" element={<ClienteDetalle />} />
            <Route
              path="clientes/:id/estado"
              element={
                <ConPermiso permiso="verDinero">
                  <EstadoCuenta />
                </ConPermiso>
              }
            />
            <Route path="calculadora" element={<Calculadora />} />
            <Route
              path="reportes"
              element={
                <ConPermiso permiso="verReportes">
                  <Reportes />
                </ConPermiso>
              }
            />
            <Route
              path="usuarios"
              element={
                <ConPermiso permiso="gestionarUsuarios">
                  <Usuarios />
                </ConPermiso>
              }
            />
            <Route path="cuenta" element={<Cuenta />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ProveedorSesion>
  )
}

// Exige sesión iniciada, contraseña definida, cuenta activa y sesión
// verificada en dos pasos (por dispositivo confiable o por código).
function ConSesion() {
  const { cargando, sesion, perfil, verificacion, debeDefinirContrasena, salir } = useSesion()
  const ubicacion = useLocation()
  if (cargando) return <Cargando />
  if (!sesion) return <Navigate to="/entrar" replace state={{ desde: ubicacion.pathname }} />
  if (debeDefinirContrasena) return <Navigate to="/definir-contrasena" replace />
  if (!perfil?.activo) {
    return (
      <main className="centrado">
        <h1>Cuenta sin acceso</h1>
        <p className="sub">
          Tu cuenta ({sesion.user.email}) no está activa. Pide al administrador que la active.
        </p>
        <button onClick={() => void salir()}>Salir</button>
      </main>
    )
  }
  if (!verificacion?.verificada) return <DosPasos />
  return (
    <Marco>
      <Outlet />
    </Marco>
  )
}

function ConPermiso({ permiso, tambien, children }: { permiso: Permiso; tambien?: Permiso; children: ReactNode }) {
  const { perfil } = useSesion()
  const permitido = puede(perfil?.rol, permiso) || (!!tambien && puede(perfil?.rol, tambien))
  if (!permitido) {
    return (
      <>
        <h1>Sin permiso</h1>
        <p className="sub">Tu rol no tiene acceso a esta sección.</p>
      </>
    )
  }
  return children
}

export function Cargando() {
  return (
    <main className="centrado" aria-busy="true">
      <p className="sub">Cargando…</p>
    </main>
  )
}

function FaltaConfiguracion() {
  return (
    <main className="centrado">
      <h1>Falta configurar Supabase</h1>
      <p className="sub">
        Copia <code>.env.example</code> como <code>.env.local</code>, completa la URL y la clave pública de tu
        proyecto y reinicia <code>npm run dev</code>.
      </p>
    </main>
  )
}
