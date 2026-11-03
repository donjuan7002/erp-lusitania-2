-- Ejecutar UNA sola vez, en Supabase > SQL Editor, después de crear tu
-- propio usuario en Authentication > Users > "Add user" (o "Invite user").
-- Convierte ese usuario en el primer administrador. Los demás usuarios se
-- invitan desde la app, en la pantalla Usuarios.

update public.perfiles
set rol = 'admin', activo = true, nombre = 'Tu nombre'   -- ← cambia el nombre
where email = 'tu-correo@ejemplo.com';                   -- ← cambia el correo

-- Debe devolver una fila con rol = admin y activo = true:
select email, nombre, rol, activo from public.perfiles;
