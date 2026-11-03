import type { Cell, Sheet } from 'write-excel-file/browser'

export type Columna = { titulo: string; ancho?: number; formato?: string }
export type Valor = string | number | null | undefined

export type Hoja = {
  nombre: string
  // Líneas de título sobre la tabla (negocio, periodo, fecha de generación…).
  encabezado?: string[]
  columnas: Columna[]
  filas: Valor[][]
  totales?: Valor[]
}

export const FORMATO_KG = '#,##0.00'
export const FORMATO_DINERO = '#,##0.00'
export const FORMATO_PORCENTAJE = '0.00"%"'

function celda(valor: Valor, columna?: Columna, negrita = false): Cell {
  if (valor == null || valor === '') return null
  const estilo = negrita ? { fontWeight: 'bold' as const } : {}
  if (typeof valor === 'number') return { value: valor, type: Number, format: columna?.formato ?? FORMATO_KG, ...estilo }
  return { value: valor, type: String, ...estilo }
}

// Genera y descarga un .xlsx. La librería se carga solo al exportar.
export async function exportarExcel(archivo: string, hojas: Hoja[]) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  const sheets: Sheet<Blob>[] = hojas.map((h) => {
    const data: Cell[][] = []
    for (const linea of h.encabezado ?? []) data.push([celda(linea, undefined, true)])
    if (h.encabezado?.length) data.push([])
    data.push(h.columnas.map((c) => celda(c.titulo, undefined, true)))
    for (const fila of h.filas) data.push(fila.map((v, i) => celda(v, h.columnas[i])))
    if (h.totales) data.push(h.totales.map((v, i) => celda(v, h.columnas[i], true)))
    return {
      sheet: h.nombre.slice(0, 31),
      data,
      columns: h.columnas.map((c) => ({ width: c.ancho ?? 14 })),
      stickyRowsCount: (h.encabezado?.length ? h.encabezado.length + 1 : 0) + 1,
    }
  })
  await writeXlsxFile(sheets).toFile(archivo)
}

// Nombre de archivo seguro a partir de un texto («Finca El Roble» → «finca-el-roble»).
export const nombreArchivo = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
