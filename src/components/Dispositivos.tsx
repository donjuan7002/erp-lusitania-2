export type Dispositivo = {
  id: string
  usuario_id: string
  nombre: string
  creado_en: string
  vence_en: string
  ultimo_uso: string | null
  revocado_en: string | null
}

// El hash del token no se puede leer desde la app: siempre se piden columnas.
export const COLUMNAS_DISPOSITIVO = 'id, usuario_id, nombre, creado_en, vence_en, ultimo_uso, revocado_en'

const dia = (iso: string) => new Date(iso).toLocaleDateString('es', { dateStyle: 'medium' })

export function ListaDispositivos({
  dispositivos,
  actual,
  ocupado,
  onRevocar,
}: {
  dispositivos: Dispositivo[]
  actual?: string | null
  ocupado?: boolean
  onRevocar: (d: Dispositivo) => void
}) {
  if (dispositivos.length === 0) return <p className="sub">No hay dispositivos confiables.</p>
  const ahora = Date.now()
  return (
    <>
      {dispositivos.map((d) => {
        const vigente = !d.revocado_en && new Date(d.vence_en).getTime() > ahora
        return (
          <div key={d.id} className="fila">
            <span>
              {d.nombre} {d.id === actual && <small className="etiqueta buena">este equipo</small>}
              <small>
                Registrado el {dia(d.creado_en)}
                {d.ultimo_uso && ` · último uso ${dia(d.ultimo_uso)}`}
              </small>
              <small>
                {d.revocado_en
                  ? `Revocado el ${dia(d.revocado_en)}`
                  : vigente
                    ? `Confiable hasta el ${dia(d.vence_en)}`
                    : `Venció el ${dia(d.vence_en)}`}
              </small>
            </span>
            {vigente && (
              <button className="secundario ancho-auto" disabled={ocupado} onClick={() => onRevocar(d)}>
                Revocar
              </button>
            )}
          </div>
        )
      })}
    </>
  )
}
