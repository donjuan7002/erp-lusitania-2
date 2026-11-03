export type Mensaje = { ok: boolean; texto: string } | null

export function Aviso({ mensaje }: { mensaje: Mensaje }) {
  if (!mensaje) return null
  return (
    <p className={mensaje.ok ? 'aviso-ok' : 'aviso-error'} role={mensaje.ok ? 'status' : 'alert'}>
      {mensaje.texto}
    </p>
  )
}
