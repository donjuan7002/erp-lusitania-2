# Plan de pruebas antes de arrancar

Hazlo en la app **publicada** (no en localhost), con 3 o 4 personas reales. Marca cada punto y anota lo que falle
(qué hiciste, en qué equipo, qué esperabas y qué pasó).

## Equipos

Prueba al menos una vez en cada uno:

- [ ] Windows con Chrome o Edge (instalada como app)
- [ ] Mac con Safari o Chrome (instalada)
- [ ] iPhone con Safari (agregada a la pantalla de inicio)
- [ ] Android con Chrome (instalada)

## Cuentas y verificación

- [ ] El administrador invita a una persona. Le llega el correo, crea su contraseña y configura la app autenticadora.
- [ ] Al salir y volver a entrar en el mismo equipo, **no** pide código.
- [ ] En un equipo nuevo (o en una ventana privada) **sí** pide código.
- [ ] Con «Confiar en este equipo» desmarcado, el equipo no aparece en Mi cuenta → Equipos de confianza.
- [ ] Un código de recuperación permite entrar; el mismo código no sirve una segunda vez.
- [ ] Tras 5 códigos equivocados se bloquea 15 minutos.
- [ ] El administrador revoca un equipo: ese equipo vuelve a pedir código de inmediato.
- [ ] El administrador desactiva a alguien: esa persona ya no puede entrar. Al reactivarla, vuelve a entrar.
- [ ] No se puede activar a una persona número 16.
- [ ] «¿Olvidaste tu contraseña?» envía el correo y permite cambiarla.

## Permisos por rol

- [ ] **Operador**: registra recibos, entregas y clientes; **no ve** dinero (tarifa, cobros, saldos ni pagos) ni
      Reportes ni Usuarios.
- [ ] **Consulta**: ve saldos, pagos y reportes; **no puede** registrar ni editar nada.
- [ ] **Administrador**: puede todo, incluido anular y cambiar la tarifa.

## Operación

- [ ] Recibo → entrega → pago para un cliente: el saldo y el rendimiento coinciden con tu cálculo a mano.
- [ ] Cambiar la tarifa no cambia los cobros de recibos anteriores.
- [ ] Anular una entrega devuelve el recibo a «En proceso»; anular un pago sube el saldo.
- [ ] La app no deja registrar más oro que pergamino ni fechas futuras.
- [ ] Los filtros de Café (cliente, estado, fechas) funcionan.

## Reportes y exportación

- [ ] El total por cobrar de Reportes coincide con el del Resumen y con Clientes.
- [ ] El Excel del reporte abre en Excel o Google Sheets con los números bien.
- [ ] «Imprimir o PDF» produce un PDF limpio, sin menús.
- [ ] El estado de cuenta de un cliente cuadra (saldo final = saldo del cliente).
- [ ] «Compartir resumen» abre WhatsApp o el correo en el celular.
- [ ] La copia completa (administrador) incluye clientes, recibos y pagos.

## Publicación y app

- [ ] Tras publicar una versión nueva, aparece «Hay una versión nueva» → Actualizar.
- [ ] Sin internet (modo avión), la app abre y muestra el aviso «Sin conexión».
- [ ] La auditoría (Supabase → Table Editor → `auditoria`) registra los cambios de tarifa, pagos y usuarios.
