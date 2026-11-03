# Fase 1: base de datos, usuarios, roles y login con contraseña

## Qué quedó hecho

- **Base de datos** ([migración](../supabase/migrations/20261103000001_fase1_esquema.sql)): tablas `perfiles`,
  `clientes`, `configuracion`, `recibos`, `entregas`, `pagos` y `auditoria`.
- **Roles** admin, operador y consulta, con **reglas de seguridad por fila** que siguen la tabla de permisos de la
  especificación. Algunos ejemplos:
  - El operador registra recibos, pero no ve la tarifa: la vista `recibos_operacion` le muestra los recibos sin precios.
  - La tarifa de cada recibo la pone el servidor al registrarlo, y un cambio de tarifa no altera los recibos pasados.
  - Nadie borra registros: se anulan con un motivo, y no se pueden reactivar.
  - Cada cambio queda en `auditoria` con quién, cuándo, valor anterior y valor nuevo. Solo el administrador la lee.
  - Hay un máximo de **15 usuarios activos** y siempre queda al menos un administrador.
- **Usuarios por invitación**: el administrador invita desde la pantalla *Usuarios*. La invitación pasa por una
  función del servidor ([admin-usuarios](../supabase/functions/admin-usuarios/index.ts)), que es la única que usa la
  clave secreta.
- **App (PWA)**: entrar, recuperar contraseña, crear contraseña desde la invitación, *Mi cuenta* y *Usuarios*
  (invitar, cambiar rol, activar o desactivar, reenviar enlace). Las demás secciones aparecen como «en construcción».
- **Pruebas**: `npm run probar:sql` comprueba las reglas de seguridad en un Postgres de prueba.

## Lo que tienes que hacer tú

### 1. Crear la cuenta y el proyecto de Supabase

1. Crea una cuenta gratis en <https://supabase.com> (puedes entrar con GitHub o con tu correo).
2. Pulsa **New project**:
   - **Name**: `trilla-cafe`.
   - **Database Password**: pulsa *Generate* y guárdala en tu gestor de contraseñas. La app no la usa, pero la
     necesitarás para administrar la base de datos.
   - **Region**: la más cercana a la trilladora (por ejemplo, *South America (São Paulo)*).
3. Espera a que el proyecto termine de crearse (1 o 2 minutos).

### 2. Crear las tablas

1. En el proyecto, abre **SQL Editor → New query**.
2. Pega todo el contenido de `supabase/migrations/20261103000001_fase1_esquema.sql` y pulsa **Run**.
3. Debe responder *Success. No rows returned*.

### 3. Configurar el acceso (Authentication)

En **Authentication**:

- **Sign In / Providers → Email**:
  - Desactiva **Allow new users to sign up**. Así nadie puede registrarse solo; las cuentas solo llegan por invitación.
  - Deja activado **Confirm email**.
  - En **Minimum password length** pon `10`.
- **URL Configuration**:
  - **Site URL**: `http://localhost:5173` (en la fase 5 la cambiaremos por la dirección pública).
  - **Redirect URLs**: añade `http://localhost:5173/**`.
- **Emails → Templates** (opcional, recomendado): pasa al español las plantillas *Invite user* y *Reset password*.
  Por ejemplo, para *Invite user*:
  - Asunto: `Te invitaron a Trilla de café`
  - Cuerpo: `<h2>Te invitaron a Trilla de café</h2><p><a href="{{ .ConfirmationURL }}">Crear mi contraseña</a></p>`

### 4. Correo para las invitaciones (importante)

El correo que trae Supabase de serie **solo envía a los miembros de tu equipo en Supabase** y apenas unos pocos
correos por hora. Sirve para probar con tu propio correo, pero no para invitar a los 15 usuarios.

Para invitar a cualquier persona, configura un servicio de correo propio. Por ejemplo, **Resend** (gratis hasta
3.000 correos al mes):

1. Crea una cuenta en <https://resend.com>.
2. En **Domains**, añade y verifica un dominio tuyo (te pedirá unos registros DNS). Si no tienes dominio, puedes dejar
   este paso para la fase 5 y probar mientras tanto solo con tu correo.
3. En **API Keys**, crea una clave (empieza por `re_`). **Es secreta**: no la pegues en el código ni la compartas.
4. En Supabase: **Authentication → Emails → SMTP Settings → Enable custom SMTP**:
   - Host `smtp.resend.com`, puerto `465`, usuario `resend`, contraseña: la clave `re_…`.
   - Sender email: `no-responder@tudominio.com`; Sender name: `Trilla de café`.

### 5. Crear el primer administrador (tú)

1. **Authentication → Users → Add user → Create new user**: escribe tu correo y una contraseña, y marca
   **Auto Confirm User**.
2. En **SQL Editor**, abre `supabase/arranque-admin.sql`, cambia el nombre y el correo, y pulsa **Run**. Debe mostrar
   tu fila con `rol = admin` y `activo = true`.

### 6. Conectar la app con el proyecto

1. Copia `.env.example` como `.env.local` (en la raíz del proyecto).
2. En Supabase, abre **Project Settings → API Keys** y **Data API**, y copia:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **Publishable key** (`sb_publishable_…`, o la *anon key* si tu proyecto muestra las claves antiguas) →
     `VITE_SUPABASE_PUBLISHABLE_KEY`

   Estas dos son públicas. **No copies nunca la Secret key / service_role a la app.**

### 7. Publicar la función de invitaciones

Desde la carpeta del proyecto, en una terminal:

```bash
npx supabase login
```

(Abre el navegador para autorizar la CLI; no tienes que copiar ninguna clave.)

```bash
npx supabase link --project-ref TU_REFERENCIA
```

`TU_REFERENCIA` es el código de la URL de tu proyecto (`https://TU_REFERENCIA.supabase.co`). Te pedirá la contraseña
de la base de datos del paso 1.

```bash
npx supabase functions deploy admin-usuarios --no-verify-jwt
```

Supabase le pasa a la función, de forma automática y privada, la URL y las claves que necesita. No hay que configurar
nada más. (`--no-verify-jwt` es correcto: la función comprueba la sesión y el rol de administrador en su propio
código.)

### 8. Probar

```bash
npm install
```

```bash
npm run dev
```

Abre <http://localhost:5173>, entra con tu usuario y ve a **Usuarios**. Invita a alguien con otro correo y comprueba
que le llega la invitación, que puede crear su contraseña y que ve solo lo que corresponde a su rol.

## Resumen de cuentas y claves de esta fase

| Qué | Dónde | ¿Secreta? | Dónde se usa |
| --- | --- | --- | --- |
| Cuenta de Supabase | supabase.com | Tu contraseña | Solo tú |
| Contraseña de la base de datos | Proyecto nuevo | Sí | `supabase link`; guárdala |
| Project URL | Data API | No | `.env.local` |
| Publishable / anon key | API Keys | No | `.env.local` |
| Secret / service_role key | API Keys | **Sí** | Solo dentro de la función; Supabase la inyecta sola |
| Cuenta y clave de Resend (`re_…`) | resend.com | **Sí** | Solo en la configuración SMTP de Supabase |

## Preguntas abiertas de la especificación

Siguen pendientes y conviene responderlas antes de la fase 3:

- La moneda y la tarifa real por kg (ahora: `$` y 400).
- Si la tarifa es la misma para todos los clientes o hay tarifas especiales.
- Si hay otros cobros o descuentos (transporte, mermas).
- Si hay buena señal de internet en la trilladora (si no, conviene guardar registros sin conexión).
