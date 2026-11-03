// Espejo en la interfaz de las reglas de la base de datos. Solo decide qué
// se muestra: quien realmente permite o niega es la seguridad por fila.
export type Rol = 'admin' | 'operador' | 'consulta'

export const ROLES: Rol[] = ['admin', 'operador', 'consulta']

export const nombreRol: Record<Rol, string> = {
  admin: 'Administrador',
  operador: 'Operador',
  consulta: 'Consulta',
}

export const descripcionRol: Record<Rol, string> = {
  admin: 'Todo: registros, pagos, tarifas, reportes y usuarios.',
  operador: 'Registra recibos, entregas y clientes. No ve precios ni pagos.',
  consulta: 'Ve precios, cobros, pagos y reportes. No registra nada.',
}

const permisos = {
  registrarRecibos: ['admin', 'operador'],
  verDinero: ['admin', 'consulta'],
  registrarPagos: ['admin'],
  editarClientes: ['admin', 'operador'],
  cambiarTarifas: ['admin'],
  gestionarUsuarios: ['admin'],
  verReportes: ['admin', 'consulta'],
  anularRegistros: ['admin'],
} as const satisfies Record<string, readonly Rol[]>

export type Permiso = keyof typeof permisos

export const nombrePermiso: Record<Permiso, string> = {
  registrarRecibos: 'Registrar recibos y entregas',
  verDinero: 'Ver precios, cobros y pagos',
  registrarPagos: 'Registrar pagos',
  editarClientes: 'Crear o editar clientes',
  cambiarTarifas: 'Cambiar tarifas',
  gestionarUsuarios: 'Crear usuarios y gestionar dispositivos',
  verReportes: 'Ver reportes',
  anularRegistros: 'Anular recibos, entregas y pagos',
}

export function puede(rol: Rol | null | undefined, permiso: Permiso): boolean {
  return !!rol && (permisos[permiso] as readonly Rol[]).includes(rol)
}
