# Fase 5: publicación, instalación y puesta en producción

## Qué quedó hecho

- **Lista para publicar en Cloudflare Pages**: el comando `npm run publicar` compila y sube la app.
- **Cabeceras de seguridad** (`public/_headers`):
  - Solo se acepta HTTPS (HSTS).
  - Una política de contenido que solo permite el código de la propia app y las conexiones a Supabase.
  - La app no se puede incrustar en otras páginas.
  - Hay reglas de caché para que las actualizaciones lleguen siempre.
- **Protecciones al compilar**:
  - La compilación se detiene si faltan la URL o la clave pública de Supabase, para no publicar una app que no
    funciona.
  - También se detiene si alguien pone por error la **clave secreta**, porque llegaría al navegador.
- **Actualizaciones**: cuando se publica una versión nueva, la app muestra «Hay una versión nueva» con un botón
  **Actualizar**. No se recarga sola a mitad de un registro.
- **Sin conexión**: si se cae internet, aparece un aviso de que no se guardará nada. La app abre igual desde la
  caché, pero los datos siempre vienen de Supabase.
- **Instalación guiada** en **Mi cuenta → Instalar la app**, con instrucciones según el equipo:
  - Botón directo en Chrome y Edge (Windows, Mac y Android).
  - Pasos para iPhone y iPad (Safari) y para Mac (Safari).
  - Un aviso en el Resumen, que se puede cerrar.
- **Función del servidor**: puede limitarse a la dirección pública de la app con el secreto `ORIGENES_PERMITIDOS`.
- **Comprobado en Chrome real**: la versión publicable, servida con las cabeceras de producción, registra su service
  worker, abre sin servidor desde la caché y no tiene errores ni bloqueos de la política de contenido.

## Lo que tienes que hacer tú

### 1. Cuenta de Cloudflare (gratis) y primera publicación

1. Crea una cuenta en <https://dash.cloudflare.com/sign-up>. El plan gratuito de Pages permite uso comercial.
2. Asegúrate de tener `.env.local` con la URL y la clave pública de Supabase (fase 1, paso 6).
3. En una terminal, dentro de la carpeta del proyecto:

```bash
npx wrangler login
```

(Se abre el navegador para autorizar; no tienes que copiar ninguna clave.)

```bash
npm run publicar
```

La primera vez crea el proyecto `trilla-cafe` y te da la dirección pública, por ejemplo
`https://trilla-cafe.pages.dev`. Cada vez que cambie algo, `npm run publicar` sube la versión nueva y los usuarios
verán el aviso «Actualizar».

**Dominio propio (opcional)**: si tienes un dominio, en Cloudflare → Workers & Pages → trilla-cafe → **Custom
domains** puedes usar, por ejemplo, `app.tunegocio.com`.

### 2. Apuntar Supabase a la dirección pública

En **Supabase → Authentication → URL Configuration**:

- **Site URL**: la dirección pública (por ejemplo `https://trilla-cafe.pages.dev`).
- **Redirect URLs**: añade `https://trilla-cafe.pages.dev/**`. Puedes dejar también `http://localhost:5173/**` para
  seguir probando en tu computador.

Sin esto, los enlaces de invitación y de recuperación llevarían a la dirección equivocada.

### 3. Limitar la función de invitaciones a tu app

```bash
npx supabase secrets set ORIGENES_PERMITIDOS=https://trilla-cafe.pages.dev,http://localhost:5173
```

```bash
npx supabase functions deploy admin-usuarios --no-verify-jwt
```

`ORIGENES_PERMITIDOS` no es una clave secreta, solo la lista de direcciones permitidas. Si usas un dominio propio,
agrégalo a la lista.

### 4. Plan de Supabase y copias de seguridad

La especificación pide **copias automáticas diarias y una prueba de restauración**. En el plan gratuito de Supabase
no hay copias diarias descargables y el proyecto **se pausa tras una semana sin uso**. Para producción recomiendo el
**plan Pro** (25 USD al mes aprox.), que incluye:

- Copias de seguridad diarias (7 días de historial).
- Sin pausas.
- Protección contra contraseñas filtradas: actívala en Authentication → Providers → Email.

**Prueba de restauración** (hazla una vez antes de arrancar y luego cada 3 meses):

1. Supabase → **Database → Backups** → elige la copia de ayer → **Restore to a new project**. Así no se toca el
   proyecto real.
2. En el proyecto nuevo, **Table Editor**: comprueba que `clientes`, `recibos` y `pagos` tienen las mismas filas que
   el real.
3. Borra el proyecto de prueba (Settings → General → Delete project).

Además, **cada mes** descarga la **copia completa en Excel** desde Reportes (fase 4) y guárdala fuera del computador.

### 5. Correo de producción

Si en la fase 1 dejaste el correo pendiente, ahora es imprescindible: con el correo integrado de Supabase las
invitaciones solo llegan a los miembros de tu equipo en Supabase. Configura Resend con tu dominio (fase 1, paso 4).

### 6. Pruebas con el equipo y arranque

1. Sigue el plan de pruebas de [PRUEBAS.md](PRUEBAS.md) con 3 o 4 personas (una por rol y por tipo de equipo).
2. Corrige lo que salga y vuelve a publicar.
3. Invita a las 15 personas desde **Usuarios** y envíales la [guía para el equipo](GUIA-USUARIOS.md).
4. Antes de cargar los datos reales, borra los clientes y movimientos de prueba. Si probaste en el mismo proyecto,
   avísame y preparo un script de limpieza revisado.

## Resumen de cuentas y claves de esta fase

| Qué | Dónde | ¿Secreta? | Para qué |
| --- | --- | --- | --- |
| Cuenta de Cloudflare | dash.cloudflare.com | Tu contraseña | Publicar la app |
| Autorización de wrangler | `npx wrangler login` | Se guarda en tu PC | Subir versiones |
| `ORIGENES_PERMITIDOS` | `npx supabase secrets set` | No | Limitar la función a tu app |
| Plan Pro de Supabase (recomendado) | Supabase → Billing | — | Copias diarias y sin pausas |

## Lista final antes de arrancar

- [ ] Las 4 migraciones aplicadas en Supabase.
- [ ] Registro abierto desactivado y contraseña mínima de 10 caracteres.
- [ ] Site URL y Redirect URLs con la dirección pública.
- [ ] Correo propio (SMTP) funcionando: llega una invitación a un correo externo.
- [ ] `ORIGENES_PERMITIDOS` configurado y la función publicada de nuevo.
- [ ] Tarifa, moneda y nombre del negocio reales.
- [ ] Plan Pro y una prueba de restauración hecha.
- [ ] Plan de pruebas completado.
- [ ] Tú y otra persona de confianza con rol de administrador, para no depender de una sola cuenta.
