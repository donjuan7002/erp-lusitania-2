# Fase 3: recibos, entregas, clientes y pagos

## Qué quedó hecho

- **Resumen**: monto por cobrar, kg en proceso, kg de oro entregados, rendimiento promedio, tarifa vigente y lotes
  pendientes de entrega, todo calculado en la base de datos con la función `resumen()`.
- **Café**: registrar recibos de pergamino y su entrega en oro. Se puede filtrar por cliente, estado (en proceso o
  entregado) y rango de fechas.
- **Clientes**: lista con búsqueda y saldo, alta de clientes, registro de pagos, pagos recientes y cambio de tarifa.
  Al tocar un cliente se abre su ficha: cuenta (cobrado, pagado, saldo), kg en proceso, oro entregado, rendimiento,
  recibos y pagos, y edición de sus datos.
- **Anular** (solo el administrador): recibos, entregas y pagos, siempre con un motivo que queda en la auditoría. Un
  recibo con entrega no se anula: primero se anula la entrega. Para corregir un error, se anula el registro y se
  registra de nuevo.
- **Reglas de cálculo** de la especificación, aplicadas en la base de datos:
  - Rendimiento = oro ÷ pergamino × 100.
  - Cobro = kg de pergamino × tarifa guardada en el recibo.
  - Saldo = cobrado − pagado.
  - Los registros anulados no cuentan.
- **Lo que ve cada rol**:

| | Administrador | Operador | Consulta |
| --- | --- | --- | --- |
| Registrar recibos y entregas | Sí | Sí | No |
| Ver cobros, saldos, pagos y tarifa | Sí | No (solo kg) | Sí |
| Registrar pagos | Sí | No | No |
| Crear y editar clientes | Sí | Sí | No |
| Cambiar la tarifa | Sí | No | No |
| Anular registros | Sí | No | No |

- **Validaciones del servidor**: no se aceptan fechas futuras ni más kg de oro que de pergamino; la entrega no puede
  ser anterior al recibo; no hay dos entregas vigentes para un recibo; y no se registra café de clientes inactivos.
- **Pruebas**: `npm run probar:sql` pasa 111 pruebas. Las pantallas se revisaron en tamaño de celular con un
  simulador de Supabase con datos ficticios.

## Lo que tienes que hacer tú

**No hay cuentas ni claves nuevas.**

1. En Supabase, **SQL Editor → New query**: pega `supabase/migrations/20261103000003_fase3_operacion.sql` y pulsa
   **Run**.
2. Entra como administrador, ve a **Clientes → Cambiar tarifa** y pon la **tarifa y el símbolo de moneda reales**
   (ahora son $400 de ejemplo).
3. Agrega los clientes reales y prueba el ciclo completo: recibo → entrega → pago. Revisa que el saldo y el
   rendimiento coincidan con tus cuentas.
4. Entra con un usuario **operador** y comprueba que no ve dinero, y con uno de **consulta**, que no puede registrar.

## Pendiente para fases siguientes

- Calculadora, reportes por cliente con totales, exportación a Excel o PDF y estado de cuenta imprimible (fase 4).
- Tarifa especial por cliente y otros cobros o descuentos (transporte, mermas): siguen como preguntas abiertas.
- Trabajo sin conexión: depende de si hay buena señal en la trilladora.
