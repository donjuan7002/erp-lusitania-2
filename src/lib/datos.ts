import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { mensajeDeError } from './errores'

export type Cliente = {
  id: string
  nombre: string
  telefono: string | null
  notas: string | null
  activo: boolean
}

export type Recibo = {
  id: string
  fecha: string
  cliente_id: string
  cliente_nombre: string
  kg_pergamino: number
  anulado: boolean
  motivo_anulacion: string | null
  creado_en: string
  entrega_id: string | null
  fecha_entrega: string | null
  kg_oro: number | null
  rendimiento: number | null
  // Solo en recibos_detalle (admin y consulta):
  tarifa_aplicada?: number
  cobro?: number
  costo_kg_oro?: number | null
}

export type Pago = {
  id: string
  fecha: string
  cliente_id: string
  monto: number
  metodo: string
  notas: string | null
  anulado: boolean
  motivo_anulacion: string | null
  clientes?: { nombre: string } | null
}

export type Saldo = {
  cliente_id: string
  nombre: string
  telefono: string | null
  activo: boolean
  kg_recibido: number
  cobrado: number
  pagado: number
  saldo: number
}

export type Resumen = {
  kg_recibido: number
  kg_en_proceso: number
  kg_pergamino_trillado: number
  kg_oro: number
  rendimiento: number | null
  lotes_pendientes: number
  cobrado: number | null
  pagado?: number
  por_cobrar?: number
}

export type Configuracion = { tarifa_kg: number; moneda: string; nombre_negocio: string }

export type FilaReporte = {
  cliente_id: string
  nombre: string
  activo: boolean
  kg_recibido: number
  kg_entregado: number
  kg_oro: number
  rendimiento: number | null
  cobrado: number
  pagado: number
  saldo: number
}

export type Movimiento = {
  fecha: string
  tipo: 'recibo' | 'pago'
  kg_pergamino: number | null
  tarifa_aplicada: number | null
  kg_oro: number | null
  rendimiento: number | null
  cargo: number | null
  abono: number | null
  metodo: string | null
  notas: string | null
}

export type EstadoCuenta = {
  cliente: { id: string; nombre: string; telefono: string | null }
  desde: string | null
  hasta: string | null
  saldo_inicial: number
  movimientos: Movimiento[]
}

// PostgREST entrega como máximo 1000 filas por consulta: se pide por páginas.
export async function todasLasFilas<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const pagina = 1000
  const filas: T[] = []
  for (let i = 0; ; i += pagina) {
    const { data, error } = await consulta(i, i + pagina - 1)
    if (error) throw error
    filas.push(...(data ?? []))
    if (!data || data.length < pagina) return filas
  }
}

export const METODOS_PAGO: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  otro: 'Otro',
}

// El operador no puede leer la tabla de recibos (tiene precios): usa la
// vista sin precios. Admin y consulta usan la vista con cobro y tarifa.
export const vistaRecibos = (verDinero: boolean) => (verDinero ? 'recibos_detalle' : 'recibos_operacion')

export type FiltroRecibos = {
  verDinero: boolean
  clienteId?: string
  desde?: string
  hasta?: string
  estado?: 'todos' | 'pendientes' | 'entregados'
  anulados?: boolean
  limite?: number
}

export async function listarRecibos(f: FiltroRecibos): Promise<Recibo[]> {
  let q = supabase
    .from(vistaRecibos(f.verDinero))
    .select('*')
    .order('fecha', { ascending: false })
    .order('creado_en', { ascending: false })
    .limit(f.limite ?? 50)
  if (f.clienteId) q = q.eq('cliente_id', f.clienteId)
  if (f.desde) q = q.gte('fecha', f.desde)
  if (f.hasta) q = q.lte('fecha', f.hasta)
  if (!f.anulados) q = q.eq('anulado', false)
  if (f.estado === 'pendientes') q = q.is('entrega_id', null)
  if (f.estado === 'entregados') q = q.not('entrega_id', 'is', null)
  const { data, error } = await q
  if (error) throw error
  return data as Recibo[]
}

export async function listarClientes(soloActivos = false): Promise<Cliente[]> {
  let q = supabase.from('clientes').select('id, nombre, telefono, notas, activo').order('nombre')
  if (soloActivos) q = q.eq('activo', true)
  const { data, error } = await q
  if (error) throw error
  return data
}

export async function listarPagos(opciones: { clienteId?: string; limite?: number; anulados?: boolean }) {
  let q = supabase
    .from('pagos')
    .select('id, fecha, cliente_id, monto, metodo, notas, anulado, motivo_anulacion, clientes(nombre)')
    .order('fecha', { ascending: false })
    .order('creado_en', { ascending: false })
    .limit(opciones.limite ?? 20)
  if (opciones.clienteId) q = q.eq('cliente_id', opciones.clienteId)
  if (!opciones.anulados) q = q.eq('anulado', false)
  const { data, error } = await q
  if (error) throw error
  return data as unknown as Pago[]
}

export async function listarSaldos(): Promise<Saldo[]> {
  const { data, error } = await supabase.from('saldos_clientes').select('*').order('nombre')
  if (error) throw error
  return data as Saldo[]
}

export async function obtenerConfiguracion(): Promise<Configuracion | null> {
  const { data, error } = await supabase.from('configuracion').select('tarifa_kg, moneda, nombre_negocio').maybeSingle()
  if (error) throw error
  return data
}

// Anula un recibo, entrega o pago pidiendo el motivo. Devuelve false si se cancela.
export async function anular(tabla: 'recibos' | 'entregas' | 'pagos', id: string, descripcion: string) {
  const motivo = window.prompt(`Motivo para anular ${descripcion}:`)?.trim()
  if (!motivo) return false
  const { error } = await supabase.from(tabla).update({ anulado: true, motivo_anulacion: motivo }).eq('id', id)
  if (error) throw error
  return true
}

// Carga datos al montar y cuando cambian las dependencias; recargar() repite.
export function useCarga<T>(cargar: () => Promise<T>, deps: unknown[]) {
  const [estado, setEstado] = useState<{ datos: T | null; error: string; cargando: boolean }>({
    datos: null,
    error: '',
    cargando: true,
  })
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let vigente = true
    setEstado((e) => ({ ...e, cargando: true }))
    cargar().then(
      (datos) => vigente && setEstado({ datos, error: '', cargando: false }),
      (e) => vigente && setEstado((x) => ({ ...x, error: mensajeDeError(e), cargando: false })),
    )
    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version])

  return { ...estado, recargar: () => setVersion((v) => v + 1) }
}
