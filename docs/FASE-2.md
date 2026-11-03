# Fase 2: verificación en dos pasos con dispositivos confiables

## Cómo funciona

1. La persona entra con su correo y su contraseña.
2. Si el equipo es **de confianza**, entra directamente. La app presenta un token que el servidor comprueba: debe
   ser de esa persona, no estar revocado y no tener más de 90 días.
3. Si el equipo **no es de confianza**, la app pide el código de 6 dígitos de la app autenticadora (TOTP). Al
   verificarlo puede marcar el equipo como confiable (la casilla viene marcada; en equipos ajenos hay que
   desmarcarla).
4. La primera vez que alguien entra, configura su app autenticadora escaneando un QR y recibe **10 códigos de
   recuperación**.

La comprobación es del servidor, no del navegador. La base de datos solo entrega datos si **la sesión concreta**
(el `session_id` de Supabase) quedó verificada en el servidor. Con solo la contraseña no se ve nada, aunque alguien
manipule la app.

| Regla | Valor |
| --- | --- |
| Vigencia de un equipo de confianza | 90 días |
| Vigencia de una verificación sin recordar el equipo | 12 horas |
| Bloqueo por códigos fallidos | 5 intentos, luego 15 minutos |
| Códigos de recuperación | 10, cada uno de un solo uso |
| Reutilizar un código TOTP ya usado | No permitido |

Lo que cada persona y el administrador pueden hacer:

- **Mi cuenta**: ver y revocar sus equipos de confianza, generar códigos de recuperación nuevos y cambiar de app
  autenticadora (por ejemplo, al estrenar celular).
- **Usuarios** (administrador): ver y revocar los equipos de cada persona. Si alguien perdió el celular y también los
  códigos, puede **restablecer su verificación**: la persona configura una app nueva al volver a entrar. Todo queda
  en la auditoría.

### Decisión técnica

El TOTP está programado dentro de la base de datos (estándar RFC 6238, probado con los vectores oficiales) en lugar
de usar el MFA de Supabase. El motivo: en el plan gratuito, Supabase no permite contar intentos fallidos por cuenta,
y la especificación pide bloqueo, códigos de recuperación y dispositivos confiables validados en el servidor. Así
todo queda en un solo lugar y está cubierto por `npm run probar:sql` (91 pruebas).

## Lo que tienes que hacer tú

**No hay cuentas ni claves nuevas en esta fase.**

1. **Aplicar la migración**: en Supabase, abre **SQL Editor → New query**, pega el contenido de
   `supabase/migrations/20261103000002_fase2_dos_pasos.sql` y pulsa **Run**.
2. **Configurar tu propia app autenticadora**: abre la app (`npm run dev`) y entra. Como tu sesión todavía no está
   verificada, verás la pantalla «Protege tu cuenta». Sigue los pasos y **guarda los códigos de recuperación fuera
   del celular** (por ejemplo, impresos o en tu gestor de contraseñas).
3. **Avisar al equipo**: cada persona necesita en su celular una app autenticadora gratuita, como **Google
   Authenticator** o **Microsoft Authenticator**. La hora del celular debe estar en automático; si va adelantada o
   atrasada más de un minuto, los códigos no funcionarán.
4. **Opcional, en Supabase → Authentication → Sessions**: puedes fijar un tiempo de inactividad tras el cual se
   cierra la sesión (por ejemplo, 7 días). No es obligatorio: los equipos de confianza ya vencen a los 90 días.

## Límites que conviene conocer

- **Bloqueo de contraseña por cuenta**: el bloqueo tras 5 fallos se aplica al **código de dos pasos**, que es lo que
  protege la cuenta aunque alguien adivine la contraseña. Los intentos de contraseña los limita Supabase por
  dirección IP. Un bloqueo de contraseña por cuenta necesita el plan Team de Supabase (*Password Verification Hook*);
  si algún día lo contratas, se puede añadir.
- **Primer acceso**: quien todavía no configuró su app puede configurarla solo con su contraseña. Es inevitable (es
  su primer factor) y el riesgo es bajo, porque la contraseña la crea la propia persona desde el correo de invitación.
  Si el administrador restablece la verificación de alguien, debería confirmar antes su identidad (por ejemplo,
  en persona o por teléfono).
- **Navegador en modo privado**: no guarda el token, así que pedirá código cada vez. Es lo esperado.
