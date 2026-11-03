import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useSesion } from '../lib/sesion'
import { puede } from '../lib/permisos'
import { obtenerConfiguracion, useCarga, type Resumen } from '../lib/datos'
import { dinero, kg, leerNumero, porcentaje } from '../lib/formato'

// Estima el oro que saldrá de un lote y lo que se cobrará por trillarlo.
// No guarda nada: es solo para cotizar.
export default function Calculadora() {
  const { perfil } = useSesion()
  const verDinero = puede(perfil?.rol, 'verDinero')

  const config = useCarga(() => (verDinero ? obtenerConfiguracion() : Promise.resolve(null)), [verDinero])
  const resumen = useCarga(async () => {
    const { data, error } = await supabase.rpc('resumen')
    if (error) throw error
    return data as Resumen
  }, [])

  const historico = resumen.datos?.rendimiento
  // null = usar el valor sugerido (rendimiento histórico y tarifa vigente).
  const [kgTexto, setKg] = useState('2500')
  const [rendTexto, setRend] = useState<string | null>(null)
  const [tarifaTexto, setTarifa] = useState<string | null>(null)
  const rendValor = rendTexto ?? String(historico ?? 80)
  const tarifaValor = tarifaTexto ?? String(config.datos?.tarifa_kg ?? '')
  const moneda = config.datos?.moneda ?? '$'

  const pergamino = leerNumero(kgTexto)
  const rendimiento = leerNumero(rendValor)
  const tarifa = leerNumero(tarifaValor)
  const oro = pergamino > 0 && rendimiento >= 0 ? (pergamino * rendimiento) / 100 : NaN
  const cobro = pergamino > 0 && tarifa >= 0 ? pergamino * tarifa : NaN

  return (
    <>
      <h1>Calculadora de trilla</h1>
      <p className="sub">
        {verDinero ? 'Estima el oro que saldrá y lo que cobrarás.' : 'Estima el oro que saldrá de un lote.'} No se
        guarda nada.
      </p>

      <div className="form">
        <label htmlFor="calc-kg">Kilogramos de pergamino</label>
        <input id="calc-kg" inputMode="decimal" value={kgTexto} onChange={(e) => setKg(e.target.value)} />
        <label htmlFor="calc-rend">Rendimiento esperado (%)</label>
        <input id="calc-rend" inputMode="decimal" value={rendValor} onChange={(e) => setRend(e.target.value)} />
        {historico != null && (
          <small className="sub sin-margen">
            Rendimiento promedio de la trilladora: {porcentaje(historico)}.{' '}
            {rendTexto !== null && (
              <button type="button" className="enlace" onClick={() => setRend(null)}>
                Usar este
              </button>
            )}
          </small>
        )}
        {verDinero && (
          <>
            <label htmlFor="calc-tarifa">Tarifa de trilla por kg de pergamino ({moneda})</label>
            <input id="calc-tarifa" inputMode="decimal" value={tarifaValor} onChange={(e) => setTarifa(e.target.value)} />
            {config.datos && tarifaTexto !== null && (
              <button type="button" className="enlace" onClick={() => setTarifa(null)}>
                Usar la tarifa vigente ({dinero(config.datos.tarifa_kg, moneda)})
              </button>
            )}
          </>
        )}
      </div>

      <h2>Resultado</h2>
      {rendimiento > 100 && <p className="aviso-error">El rendimiento no puede pasar de 100%.</p>}
      <div className="fila">
        <span>Oro esperado</span>
        <b className="num">{Number.isFinite(oro) && rendimiento <= 100 ? kg(oro) : '—'}</b>
      </div>
      {verDinero && (
        <>
          <div className="fila">
            <span>Cobro por la trilla</span>
            <b className="num">{Number.isFinite(cobro) ? dinero(cobro, moneda) : '—'}</b>
          </div>
          <div className="fila">
            <span>Costo por kilogramo de oro</span>
            <b className="num">{Number.isFinite(cobro) && oro > 0 ? dinero(cobro / oro, moneda) : '—'}</b>
          </div>
        </>
      )}
    </>
  )
}
