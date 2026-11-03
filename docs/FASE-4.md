# Fase 4: calculadora, reportes y exportación

## Qué quedó hecho

- **Calculadora**: con los kg de pergamino, el rendimiento esperado y la tarifa calcula el oro esperado, el cobro y
  el costo por kg de oro. Sugiere el rendimiento promedio real de la trilladora y la tarifa vigente. El operador solo
  ve el oro esperado. No guarda nada.
- **Reportes** (administrador y consulta): una tabla por cliente con recibido, oro, rendimiento, cobrado, pagado y
  saldo, más los totales. El periodo se elige entre este mes, mes anterior, este año, todo el historial o fechas a
  mano.
  - Recibido, oro y cobrado salen de los recibos del periodo.
  - El rendimiento solo cuenta lo ya entregado.
  - El saldo es la deuda total del cliente a la fecha final del periodo.
- **Exportación**:
  - **Excel** del reporte por cliente.
  - **Movimientos del periodo** en Excel: una hoja de recibos (con su entrega) y otra de pagos.
  - **Imprimir o PDF**: la página se imprime limpia, sin menús y en blanco y negro. En el cuadro de impresión se elige
    «Guardar como PDF». Funciona en Windows, Mac, iPhone y Android.
  - **Copia de seguridad completa** (solo el administrador): clientes, recibos y pagos, incluidos los anulados, en un
    solo Excel.
- **Estado de cuenta por cliente** (desde la ficha del cliente → «Estado de cuenta imprimible»): saldo anterior,
  cada recibo como cargo y cada pago como abono, saldo corrido y saldo final. Se puede imprimir o guardar en PDF,
  bajar en Excel o **compartir un resumen** por WhatsApp o por correo desde el celular.
- **Nombre del negocio**: encabeza los impresos y los Excel. Se cambia en Clientes → Cambiar tarifa.
- **Pruebas**: `npm run probar:sql` pasa 125 pruebas. Se comprueba, entre otras cosas, que la suma de saldos del
  reporte coincide con el «por cobrar» del resumen. Las pantallas se revisaron con datos ficticios, y se comprobó
  que los archivos de Excel generados son válidos.

## Lo que tienes que hacer tú

**No hay cuentas ni claves nuevas.**

1. En Supabase, **SQL Editor → New query**: pega `supabase/migrations/20261103000004_fase4_reportes.sql` y pulsa
   **Run**.
2. En la app, **Clientes → Cambiar tarifa**: escribe el nombre real del negocio.
3. Prueba un estado de cuenta con un cliente real e imprímelo o guárdalo en PDF.
4. **Hábito recomendado**: una vez al mes, en **Reportes → Descargar copia completa**, guarda el Excel fuera del
   computador (en una memoria USB o en tu nube). Es la «exportación periódica a Excel» que pide la especificación,
   aparte de las copias automáticas de Supabase que configuraremos en la fase 5.

## Notas

- En el celular, las tablas anchas se desplazan de lado. Para leerlas completas es mejor imprimir o usar el Excel.
- Faltan dos funciones sugeridas que dependen de tus respuestas: la tarifa especial por cliente y otros cobros o
  descuentos (transporte, mermas).
