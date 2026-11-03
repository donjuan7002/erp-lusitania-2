# Trilla de café

App web instalable (PWA) para gestionar un negocio de trilla de café: recibos de pergamino, entregas de oro, clientes,
pagos, reportes y usuarios con roles.

- **Frontend**: Vite + React + TypeScript + vite-plugin-pwa.
- **Backend**: Supabase (Postgres con seguridad por fila, Auth y Edge Functions).

## Fases

1. Base de datos, usuarios, roles y login con contraseña. **Hecha.** Guía de configuración: [docs/FASE-1.md](docs/FASE-1.md)
2. Verificación en dos pasos (TOTP) con dispositivos confiables. **Hecha.** Guía: [docs/FASE-2.md](docs/FASE-2.md)
3. Recibos, entregas, clientes y pagos. **Hecha.** Guía: [docs/FASE-3.md](docs/FASE-3.md)
4. Calculadora, reportes y exportación. **Hecha.** Guía: [docs/FASE-4.md](docs/FASE-4.md)
5. Instalación en los cuatro sistemas, pruebas con los 15 usuarios y puesta en producción. **Lista para publicar.**
   Guía: [docs/FASE-5.md](docs/FASE-5.md) · [Plan de pruebas](docs/PRUEBAS.md) ·
   [Guía para el equipo](docs/GUIA-USUARIOS.md)

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | App en <http://localhost:5173> |
| `npm run build` | Revisa los tipos y genera `dist/` |
| `npm run probar:sql` | Prueba las migraciones y las reglas de seguridad |
| `npm run iconos` | Regenera los iconos desde `public/icono.svg` |
| `npm run publicar` | Compila y sube la app a Cloudflare Pages |

`npm run build` exige `.env.local` con la URL y la clave pública de Supabase (ver `.env.example`).

## Estructura

- `supabase/migrations/`: esquema, roles, reglas por fila y auditoría.
- `supabase/functions/admin-usuarios/`: invitaciones y gestión de usuarios (la única pieza con la clave secreta).
- `src/lib/`: cliente de Supabase, sesión, permisos y mensajes de error.
- `src/pages/`: pantallas.
