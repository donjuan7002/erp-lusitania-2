// Prueba las migraciones y las reglas de seguridad por fila en un Postgres
// embebido (PGlite), simulando lo mínimo del esquema auth de Supabase.
// Uso: npm run probar:sql
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHmac, randomUUID } from 'node:crypto'

const db = new PGlite({ extensions: { pgcrypto } })

// --- Simulación mínima de Supabase -----------------------------------
// Como en Supabase, el JWT llega en request.jwt.claims (sub y session_id).
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema extensions;
  create extension pgcrypto with schema extensions;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  grant usage on schema public, auth, extensions to anon, authenticated, service_role;
  grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`)

const carpeta = 'supabase/migrations'
for (const archivo of readdirSync(carpeta).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(join(carpeta, archivo), 'utf8'))
  console.log(`migración aplicada: ${archivo}`)
}

// --- Utilidades -------------------------------------------------------
let fallas = 0
let pruebas = 0
function ok(cond, nombre) {
  pruebas++
  if (cond) console.log(`  ✓ ${nombre}`)
  else {
    fallas++
    console.log(`  ✗ ${nombre}`)
  }
}

// Ejecuta una consulta como un usuario (o como anónimo si es null).
// `quien` es el id del usuario (usa su sesión principal, cuyo id es el mismo)
// o { id, sesion } para simular otra sesión, por ejemplo en otro dispositivo.
async function como(quien, sql, params = []) {
  const id = typeof quien === 'string' ? quien : quien?.id
  const sesion = typeof quien === 'string' ? quien : quien?.sesion
  const claims = id ? JSON.stringify({ sub: id, session_id: sesion, role: 'authenticated' }) : ''
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims])
  await db.exec(id ? 'set role authenticated' : 'set role anon')
  try {
    return await db.query(sql, params)
  } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claims', '', false)`)
  }
}
const nuevaSesion = (id) => ({ id, sesion: randomUUID() })
// Devuelve el mensaje de error, o null si la consulta funcionó.
async function falla(promesa) {
  try {
    await promesa
    return null
  } catch (e) {
    return e.message
  }
}
async function comoServidor(sql, params = []) {
  await db.exec('reset role')
  return db.query(sql, params)
}
// Crea un usuario. Para las pruebas de permisos de la fase 1 su sesión
// principal se da por verificada en dos pasos (eso se prueba aparte).
async function crearUsuario(email, nombre = '', { verificada = true } = {}) {
  const r = await comoServidor(
    `insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('nombre', $2::text)) returning id`,
    [email, nombre],
  )
  const id = r.rows[0].id
  if (verificada) {
    await comoServidor(
      `insert into privado.sesiones_verificadas (session_id, usuario_id, metodo, vence_en)
       values ($1, $1, 'totp', now() + interval '1 day')`,
      [id],
    )
  }
  return id
}
// Código TOTP vigente para un secreto base32, calculado como lo haría el celular.
function totp(secretoBase32, desfasePasos = 0) {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secretoBase32) bits += alfabeto.indexOf(c).toString(2).padStart(5, '0')
  const clave = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
  const paso = BigInt(Math.floor(Date.now() / 1000 / 30) + desfasePasos)
  const mensaje = Buffer.alloc(8)
  mensaje.writeBigUInt64BE(paso)
  const h = createHmac('sha1', clave).update(mensaje).digest()
  const o = h[19] & 15
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(n % 1000000).padStart(6, '0')
}
const filas = async (uid, sql, params) => (await como(uid, sql, params)).rows.length

// --- Pruebas ----------------------------------------------------------
console.log('\nAlta de usuarios')
const admin = await crearUsuario('admin@trilla.test', 'Ana Admin')
const oper = await crearUsuario('oper@trilla.test', 'Óscar Operador')
const cons = await crearUsuario('cons@trilla.test', 'Carla Consulta')
const p = (await comoServidor('select * from public.perfiles where id = $1', [admin])).rows[0]
ok(p?.activo === false && p?.rol === 'consulta', 'un usuario nuevo nace inactivo con rol consulta')
ok(p?.nombre === 'Ana Admin', 'el perfil toma el nombre de la invitación')

// Arranque: el primer administrador se activa desde la consola SQL.
await comoServidor(`update public.perfiles set rol = 'admin', activo = true where id = $1`, [admin])
ok((await filas(oper, 'select * from public.clientes')) === 0, 'un usuario inactivo no ve clientes')
ok(
  (await falla(como(admin, `update public.perfiles set rol = 'operador', activo = true where id = $1`, [oper]))) === null,
  'el admin activa y asigna el rol de otro usuario',
)
await como(admin, `update public.perfiles set rol = 'consulta', activo = true where id = $1`, [cons])

console.log('\nPerfiles')
ok((await filas(oper, 'select * from public.perfiles')) === 1, 'el operador solo ve su propio perfil')
ok((await filas(admin, 'select * from public.perfiles')) === 3, 'el admin ve todos los perfiles')
ok(
  (await falla(como(oper, `update public.perfiles set rol = 'admin' where id = $1`, [oper])))?.includes('Solo el administrador'),
  'el operador no puede subirse de rol',
)
await como(oper, `update public.perfiles set nombre = 'Óscar O.' where id = $1`, [oper])
ok(
  (await comoServidor('select nombre from public.perfiles where id = $1', [oper])).rows[0].nombre === 'Óscar O.',
  'cada usuario puede cambiar su propio nombre',
)
ok(
  (await filas(oper, `update public.perfiles set nombre = 'x' where id = $1 returning id`, [cons])) === 0,
  'el operador no puede editar el perfil de otro',
)
ok(
  (await falla(como(admin, `update public.perfiles set rol = 'consulta' where id = $1`, [admin])))?.includes('al menos un administrador'),
  'no se puede quitar el último administrador',
)

console.log('\nClientes')
const cli = (await como(oper, `insert into public.clientes (nombre) values ('Finca El Roble') returning id`)).rows[0].id
ok(!!cli, 'el operador crea clientes')
ok(
  (await comoServidor('select creado_por from public.clientes where id = $1', [cli])).rows[0].creado_por === oper,
  'el cliente guarda quién lo creó',
)
ok(!!(await falla(como(cons, `insert into public.clientes (nombre) values ('X')`))), 'consulta no crea clientes')
ok((await filas(cons, 'select * from public.clientes')) === 1, 'consulta ve clientes')
ok(!!(await falla(como(admin, 'delete from public.clientes'))), 'nadie borra clientes desde la app')

console.log('\nRecibos y tarifa')
// Inserción sin "returning", como lo hará la app para el operador.
await como(oper, `insert into public.recibos (cliente_id, kg_pergamino, tarifa_aplicada) values ($1, 1000, 1)`, [cli])
const rec = (await comoServidor('select * from public.recibos')).rows[0]
ok(Number(rec.tarifa_aplicada) === 400, 'la tarifa la pone el servidor, no el navegador')
ok(rec.registrado_por === oper, 'el recibo guarda quién lo registró')
ok((await filas(oper, 'select * from public.recibos')) === 0, 'el operador no ve la tabla de recibos con precios')
const vista = await como(oper, 'select * from public.recibos_operacion')
ok(vista.rows.length === 1 && !('tarifa_aplicada' in vista.rows[0]), 'el operador ve recibos sin tarifa en recibos_operacion')
ok((await filas(oper, 'select * from public.configuracion')) === 0, 'el operador no ve la tarifa')
ok((await filas(cons, 'select * from public.recibos')) === 1, 'consulta ve recibos con precios')
ok(!!(await falla(como(cons, `insert into public.recibos (cliente_id, kg_pergamino) values ($1, 5)`, [cli]))), 'consulta no registra recibos')
ok((await filas(oper, 'update public.recibos set kg_pergamino = 1 returning id')) === 0, 'el operador no edita recibos')

ok((await filas(cons, 'update public.configuracion set tarifa_kg = 1 returning id')) === 0, 'consulta no cambia la tarifa')
await como(admin, 'update public.configuracion set tarifa_kg = 500')
await como(admin, `insert into public.recibos (cliente_id, kg_pergamino) values ($1, 200)`, [cli])
const tarifas = (await comoServidor('select tarifa_aplicada from public.recibos')).rows.map((r) => Number(r.tarifa_aplicada))
ok(tarifas.includes(400) && tarifas.includes(500), 'cambiar la tarifa no altera recibos pasados')

console.log('\nEntregas')
ok(
  (await falla(como(oper, `insert into public.entregas (recibo_id, kg_oro) values ($1, 2000)`, [rec.id])))?.includes('no pueden superar'),
  'no se entrega más oro que pergamino recibido',
)
await como(oper, `insert into public.entregas (recibo_id, kg_oro) values ($1, 800)`, [rec.id])
ok((await filas(cons, 'select * from public.entregas')) === 1, 'el operador registra entregas y consulta las ve')
ok(!!(await falla(como(oper, `insert into public.entregas (recibo_id, kg_oro) values ($1, 10)`, [rec.id]))), 'un recibo no tiene dos entregas vigentes')

console.log('\nPagos')
ok(!!(await falla(como(oper, `insert into public.pagos (cliente_id, monto) values ($1, 100)`, [cli]))), 'el operador no registra pagos')
ok(!!(await falla(como(cons, `insert into public.pagos (cliente_id, monto) values ($1, 100)`, [cli]))), 'consulta no registra pagos')
const pago = (await como(admin, `insert into public.pagos (cliente_id, monto) values ($1, 150000) returning id`, [cli])).rows[0].id
ok((await filas(cons, 'select * from public.pagos')) === 1, 'consulta ve pagos')
ok((await filas(oper, 'select * from public.pagos')) === 0, 'el operador no ve pagos')
ok(
  (await falla(como(admin, `update public.pagos set anulado = true where id = $1`, [pago])))?.includes('motivo'),
  'anular exige un motivo',
)
await como(admin, `update public.pagos set anulado = true, motivo_anulacion = 'Duplicado' where id = $1`, [pago])
ok(
  (await falla(como(admin, `update public.pagos set anulado = false where id = $1`, [pago])))?.includes('no se puede reactivar'),
  'un registro anulado no se reactiva',
)

console.log('\nAuditoría')
const aud = (await como(admin, `select * from public.auditoria where tabla = 'configuracion' and accion = 'UPDATE'`)).rows
ok(aud.length === 1 && aud[0].usuario_id === admin, 'el cambio de tarifa queda auditado con su autor')
ok(
  Number(aud[0]?.valor_anterior?.tarifa_kg) === 400 && Number(aud[0]?.valor_nuevo?.tarifa_kg) === 500,
  'la auditoría guarda valor anterior y nuevo',
)
ok((await filas(cons, 'select * from public.auditoria')) === 0, 'solo el admin lee la auditoría')
ok(!!(await falla(como(admin, `insert into public.auditoria (tabla, accion) values ('x', 'INSERT')`))), 'nadie escribe la auditoría a mano')
ok(!!(await falla(como(admin, 'delete from public.auditoria'))), 'nadie borra la auditoría')

console.log('\nAcceso anónimo')
ok(!!(await falla(como(null, 'select * from public.clientes'))), 'sin sesión no se lee nada')
ok(!!(await falla(como(null, 'select * from public.recibos_operacion'))), 'sin sesión no se lee la vista de recibos')

console.log('\nCupo de 15 usuarios')
for (let i = 4; i <= 15; i++) {
  const u = await crearUsuario(`u${i}@trilla.test`)
  await como(admin, `update public.perfiles set activo = true where id = $1`, [u])
}
ok((await comoServidor('select count(*)::int n from public.perfiles where activo')).rows[0].n === 15, 'se pueden activar 15 usuarios')
const u16 = await crearUsuario('u16@trilla.test')
ok(
  (await falla(como(admin, `update public.perfiles set activo = true where id = $1`, [u16])))?.includes('máximo de 15'),
  'el usuario 16 no se puede activar',
)
await como(admin, `update public.perfiles set activo = false where id = $1`, [cons])
ok((await falla(como(admin, `update public.perfiles set activo = true where id = $1`, [u16]))) === null, 'al desactivar uno se libera el cupo')
ok((await filas(cons, 'select * from public.clientes')) === 0, 'un usuario desactivado pierde el acceso')

// ======================================================================
// Fase 2: verificación en dos pasos y dispositivos confiables
// ======================================================================
const rpc = async (quien, funcion, args = []) => {
  const marcas = args.map((_, i) => `$${i + 1}`).join(', ')
  return (await como(quien, `select public.${funcion}(${marcas}) as r`, args)).rows[0].r
}

console.log('\nTOTP (vectores de la RFC 6238)')
ok(
  (await comoServidor(`select privado.base32(convert_to('12345678901234567890', 'UTF8')) as r`)).rows[0].r ===
    'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
  'base32 coincide con el estándar',
)
const vectores = [
  [1n, '287082'],
  [37037036n, '081804'],
  [37037037n, '050471'],
  [41152263n, '005924'],
]
for (const [paso, esperado] of vectores) {
  const r = (await comoServidor(`select privado.totp(convert_to('12345678901234567890', 'UTF8'), $1) as r`, [paso.toString()])).rows[0].r
  ok(r === esperado, `TOTP del paso ${paso} = ${esperado}`)
}

console.log('\nSesión sin verificar')
// La prueba del cupo dejó 15 activos: se liberan dos plazas.
await comoServidor(`update public.perfiles set activo = false where email in ('u14@trilla.test', 'u15@trilla.test')`)
const ana = await crearUsuario('ana@trilla.test', 'Ana', { verificada: false })
await comoServidor(`update public.perfiles set rol = 'consulta', activo = true where id = $1`, [ana])
const anaCel = nuevaSesion(ana)
ok((await filas(anaCel, 'select * from public.clientes')) === 0, 'con solo la contraseña no se ve ningún dato')
let estado = await rpc(anaCel, 'estado_verificacion')
ok(estado.verificada === false && estado.tiene_factor === false, 'el estado indica que falta configurar la app autenticadora')
ok((await filas(anaCel, 'select * from public.perfiles')) === 1, 'sí puede leer su propio perfil para mostrar su nombre')

console.log('\nConfigurar la app autenticadora')
const inscripcion = await rpc(anaCel, 'iniciar_inscripcion_totp')
ok(/^[A-Z2-7]{32}$/.test(inscripcion.secreto), 'se genera un secreto de 160 bits en base32')
let r = await rpc(anaCel, 'confirmar_inscripcion_totp', ['000000', true, 'Celular de Ana'])
ok(r.ok === false && /incorrecto/.test(r.mensaje), 'un código incorrecto no confirma')
r = await rpc(anaCel, 'confirmar_inscripcion_totp', [totp(inscripcion.secreto), true, 'Celular de Ana'])
ok(r.ok === true, 'el código de la app confirma la configuración')
ok(Array.isArray(r.codigos_recuperacion) && r.codigos_recuperacion.length === 10, 'se entregan 10 códigos de recuperación')
ok(/^[0-9a-f]{64}$/.test(r.token_dispositivo ?? ''), 'se entrega el token del dispositivo confiable')
const tokenCel = r.token_dispositivo
const codigos = r.codigos_recuperacion
ok((await filas(anaCel, 'select * from public.clientes')) === 1, 'la sesión verificada ya ve los datos de su rol')
const guardado = (await comoServidor('select huella_hash from public.dispositivos_confiables where usuario_id = $1', [ana])).rows[0]
ok(guardado.huella_hash !== tokenCel && guardado.huella_hash.length === 64, 'el servidor guarda solo el hash del token')
ok(
  !!(await falla(como(anaCel, 'select huella_hash from public.dispositivos_confiables'))),
  'nadie puede leer el hash desde la app',
)
ok(!!(await falla(como(anaCel, 'select * from privado.factores_totp'))), 'nadie puede leer los secretos TOTP desde la app')

console.log('\nDispositivo confiable')
const anaCel2 = nuevaSesion(ana) // salió y volvió a entrar con la contraseña
ok((await filas(anaCel2, 'select * from public.clientes')) === 0, 'una sesión nueva empieza sin verificar')
ok((await rpc(anaCel2, 'usar_dispositivo', [tokenCel])) !== null, 'desde el dispositivo confiable entra sin código')
ok((await filas(anaCel2, 'select * from public.clientes')) === 1, 'y ve sus datos')
const anaPc = nuevaSesion(ana)
ok((await rpc(anaPc, 'usar_dispositivo', ['f'.repeat(64)])) === null, 'un token falso no sirve')
const beto = await crearUsuario('beto@trilla.test', 'Beto', { verificada: false })
await comoServidor(`update public.perfiles set activo = true where id = $1`, [beto])
ok((await rpc(nuevaSesion(beto), 'usar_dispositivo', [tokenCel])) === null, 'el token de otra persona no sirve')
ok(
  !!(await falla(rpc(anaPc, 'iniciar_inscripcion_totp'))),
  'sin verificar no se puede cambiar la app autenticadora',
)

console.log('\nCódigo TOTP en un dispositivo nuevo')
const codigoPc = totp(inscripcion.secreto, 1)
r = await rpc(anaPc, 'verificar_totp', [codigoPc, false, 'PC'])
ok(r.ok === true && r.token_dispositivo === null, 'acepta el código y no recuerda el dispositivo si no se pide')
const anaPc2 = nuevaSesion(ana)
r = await rpc(anaPc2, 'verificar_totp', [codigoPc, false, 'PC'])
ok(r.ok === false, 'el mismo código no se puede reutilizar')

console.log('\nBloqueo tras intentos fallidos')
for (let i = 0; i < 4; i++) await rpc(anaPc2, 'verificar_totp', ['111111', false, ''])
r = await rpc(anaPc2, 'verificar_totp', ['111111', false, ''])
ok(r.ok === false && r.bloqueado_hasta !== null, 'al quinto fallo se bloquea')
r = await rpc(anaPc2, 'usar_codigo_recuperacion', [codigos[0], false, ''])
ok(r.ok === false && r.bloqueado_hasta !== null, 'el bloqueo también impide usar códigos de recuperación')
ok((await filas(anaPc2, 'select * from public.clientes')) === 0, 'la sesión bloqueada no ve datos')
await comoServidor(`update privado.intentos_verificacion set bloqueado_hasta = now() - interval '1 second' where usuario_id = $1`, [ana])

console.log('\nCódigos de recuperación')
r = await rpc(anaPc2, 'usar_codigo_recuperacion', [codigos[0].toLowerCase(), false, ''])
ok(r.ok === true && Number(r.codigos_restantes) === 9, 'un código de recuperación sirve (sin importar mayúsculas)')
r = await rpc(nuevaSesion(ana), 'usar_codigo_recuperacion', [codigos[0], false, ''])
ok(r.ok === false, 'cada código de recuperación sirve una sola vez')
const regenerados = await rpc(anaPc2, 'regenerar_codigos_recuperacion')
ok(regenerados.length === 10, 'con la sesión verificada se pueden regenerar')
r = await rpc(nuevaSesion(ana), 'usar_codigo_recuperacion', [codigos[1], false, ''])
ok(r.ok === false, 'al regenerar, los códigos anteriores dejan de servir')

console.log('\nRevocar y vencer dispositivos')
ok((await filas(anaCel2, 'select id, nombre from public.dispositivos_confiables')) === 1, 'cada quien ve sus dispositivos')
ok((await filas(beto, 'select id, nombre from public.dispositivos_confiables')) === 0, 'no ve los de otras personas')
ok((await filas(admin, 'select id, nombre from public.dispositivos_confiables')) >= 1, 'el admin ve los de todos')
const idCel = (await comoServidor('select id from public.dispositivos_confiables where usuario_id = $1', [ana])).rows[0].id
ok(!!(await falla(rpc(beto, 'revocar_dispositivo', [idCel]))), 'nadie revoca dispositivos ajenos salvo el admin')
await rpc(admin, 'revocar_dispositivo', [idCel])
ok((await filas(anaCel2, 'select * from public.clientes')) === 0, 'al revocarlo, la sesión abierta en ese celular pierde el acceso')
ok((await rpc(nuevaSesion(ana), 'usar_dispositivo', [tokenCel])) === null, 'y el celular vuelve a pedir código')

const anaTablet = nuevaSesion(ana)
// Los códigos de este intervalo ya se usaron arriba; se simula que pasó el tiempo.
await comoServidor('update privado.factores_totp set ultimo_paso = 0 where usuario_id = $1', [ana])
r = await rpc(anaTablet, 'verificar_totp', [totp(inscripcion.secreto), true, 'Tablet'])
ok(r.ok === true && !!r.token_dispositivo, 'se puede registrar otro dispositivo')
await comoServidor(`update public.dispositivos_confiables set vence_en = now() - interval '1 second' where id = $1`, [r.dispositivo_id])
ok((await rpc(nuevaSesion(ana), 'usar_dispositivo', [r.token_dispositivo])) === null, 'un dispositivo vencido (90 días) vuelve a pedir código')
ok((await filas(anaTablet, 'select * from public.clientes')) === 0, 'y la sesión abierta con él deja de tener acceso')

console.log('\nRestablecer dos pasos (administrador)')
ok(!!(await falla(rpc(beto, 'restablecer_dos_pasos', [ana]))), 'solo el admin puede restablecer')
await rpc(admin, 'restablecer_dos_pasos', [ana])
estado = await rpc(anaPc2, 'estado_verificacion')
ok(estado.tiene_factor === false && estado.verificada === false, 'la persona pierde su app y sus sesiones verificadas')
ok(!!(await rpc(anaPc2, 'iniciar_inscripcion_totp')).secreto, 'y puede configurar una app nueva')
ok(
  (await comoServidor(`select count(*)::int n from public.auditoria where tabla = 'dos_pasos'`)).rows[0].n >= 3,
  'los eventos de dos pasos quedan en la auditoría',
)
ok(!!(await falla(como(null, 'select public.estado_verificacion()'))), 'sin sesión no se puede llamar a las funciones')

// ======================================================================
// Fase 3: recibos, entregas, clientes y pagos
// ======================================================================
console.log('\nResumen y cálculos')
// La prueba del cupo desactivó al usuario de consulta: se le devuelve su plaza.
await comoServidor(`update public.perfiles set activo = false where email = 'u16@trilla.test'`)
await comoServidor(`update public.perfiles set activo = true where id = $1`, [cons])
const antes = await rpc(admin, 'resumen')
const loma = (await como(admin, `insert into public.clientes (nombre) values ('Cooperativa La Loma') returning id`)).rows[0].id
await como(oper, `insert into public.recibos (cliente_id, kg_pergamino) values ($1, 1000)`, [loma])
await como(oper, `insert into public.recibos (cliente_id, kg_pergamino) values ($1, 500)`, [loma])
const recLoma = (await comoServidor('select id from public.recibos where cliente_id = $1 and kg_pergamino = 1000', [loma])).rows[0].id
await como(oper, `insert into public.entregas (recibo_id, kg_oro) values ($1, 800)`, [recLoma])
await como(admin, `insert into public.pagos (cliente_id, monto, metodo) values ($1, 100000, 'transferencia')`, [loma])
const despues = await rpc(admin, 'resumen')
const delta = (k) => Number(despues[k]) - Number(antes[k])
ok(delta('kg_en_proceso') === 500, 'café en proceso = recibos sin entrega')
ok(delta('kg_oro') === 800, 'suma el oro entregado')
ok(delta('cobrado') === 750000, 'cobro = kg de pergamino × tarifa aplicada (1500 × 500)')
ok(delta('por_cobrar') === 650000, 'por cobrar = cobrado − pagado')
ok(delta('lotes_pendientes') === 1, 'cuenta los lotes pendientes de entrega')

const resOper = await rpc(oper, 'resumen')
ok(resOper.cobrado === null && resOper.por_cobrar === undefined, 'el operador recibe el resumen sin montos')
ok(Number(resOper.kg_oro) === Number(despues.kg_oro), 'pero sí con los kilos')
ok(!!(await falla(rpc(nuevaSesion(oper), 'resumen'))), 'una sesión sin verificar no recibe el resumen')

console.log('\nVistas de recibos')
const det = (await como(cons, 'select * from public.recibos_detalle where id = $1', [recLoma])).rows[0]
ok(Number(det.rendimiento) === 80, 'rendimiento = oro ÷ pergamino × 100')
ok(Number(det.cobro) === 500000 && Number(det.costo_kg_oro) === 625, 'cobro y costo por kg de oro')
ok(det.cliente_nombre === 'Cooperativa La Loma', 'incluye el nombre del cliente')
ok((await filas(oper, 'select id from public.recibos_detalle')) === 0, 'el operador no ve la vista con precios')
const op = (await como(oper, 'select * from public.recibos_operacion where id = $1', [recLoma])).rows[0]
ok(Number(op.kg_oro) === 800 && !('cobro' in op) && !('tarifa_aplicada' in op), 'la vista del operador trae la entrega sin precios')

console.log('\nSaldos por cliente')
const saldo = (await como(cons, 'select * from public.saldos_clientes where cliente_id = $1', [loma])).rows[0]
ok(Number(saldo.cobrado) === 750000 && Number(saldo.pagado) === 100000 && Number(saldo.saldo) === 650000, 'saldo del cliente')
ok((await filas(oper, 'select cliente_id from public.saldos_clientes')) === 0, 'el operador no ve saldos')

console.log('\nAnulaciones y fechas')
ok(
  (await falla(como(admin, `update public.recibos set anulado = true, motivo_anulacion = 'x' where id = $1`, [recLoma])))?.includes('Anula primero la entrega'),
  'no se anula un recibo que ya tiene entrega',
)
const entLoma = (await comoServidor('select id from public.entregas where recibo_id = $1', [recLoma])).rows[0].id
await como(admin, `update public.entregas set anulado = true, motivo_anulacion = 'Peso mal digitado' where id = $1`, [entLoma])
ok(Number((await rpc(admin, 'resumen')).kg_en_proceso) - Number(despues.kg_en_proceso) === 1000, 'al anular la entrega el recibo vuelve a estar en proceso')
await como(oper, `insert into public.entregas (recibo_id, kg_oro) values ($1, 790)`, [recLoma])
ok((await filas(oper, 'select id from public.recibos_operacion where kg_oro = 790')) === 1, 'se puede registrar la entrega corregida')
ok(
  (await falla(como(oper, `insert into public.recibos (cliente_id, kg_pergamino, fecha) values ($1, 10, current_date + 5)`, [loma])))?.includes('futura'),
  'no se aceptan fechas futuras',
)
await como(admin, `update public.clientes set activo = false where id = $1`, [loma])
ok(
  (await falla(como(oper, `insert into public.recibos (cliente_id, kg_pergamino) values ($1, 10)`, [loma])))?.includes('inactivo'),
  'no se registran recibos de clientes inactivos',
)

// ======================================================================
// Fase 4: reportes y estado de cuenta
// ======================================================================
console.log('\nReporte por cliente')
await como(admin, `update public.clientes set activo = true where id = $1`, [loma])
const rep = (await como(cons, `select * from public.reporte_clientes() where cliente_id = $1`, [loma])).rows[0]
// La Loma: recibos de 1000 kg (entrega vigente 790) y 500 kg, tarifa 500; pago de 100000.
ok(Number(rep.kg_recibido) === 1500 && Number(rep.kg_entregado) === 1000, 'kg recibidos y kg ya entregados')
ok(Number(rep.kg_oro) === 790 && Number(rep.rendimiento) === 79, 'oro y rendimiento solo de lo entregado')
ok(Number(rep.cobrado) === 750000 && Number(rep.pagado) === 100000 && Number(rep.saldo) === 650000, 'cobrado, pagado y saldo')
const totalSaldos = (await como(cons, 'select sum(saldo) s from public.reporte_clientes()')).rows[0].s
ok(Number(totalSaldos) === Number((await rpc(admin, 'resumen')).por_cobrar), 'la suma de saldos coincide con el resumen')
ok(!!(await falla(como(oper, 'select * from public.reporte_clientes()'))), 'el operador no ve reportes')

// Periodo: un recibo antiguo fuera del rango no cuenta en el periodo pero sí en el saldo.
await comoServidor(
  `insert into public.recibos (cliente_id, kg_pergamino, fecha) values ($1, 100, current_date - 60)`,
  [loma],
)
const repMes = (await como(cons, `select * from public.reporte_clientes(current_date - 30, current_date) where cliente_id = $1`, [loma])).rows[0]
ok(Number(repMes.kg_recibido) === 1500, 'el periodo excluye recibos anteriores')
ok(Number(repMes.saldo) === 700000, 'el saldo al corte incluye todo lo anterior (100 kg × 500 más)')
const repViejo = (await como(cons, `select * from public.reporte_clientes(null, current_date - 31) where cliente_id = $1`, [loma])).rows[0]
ok(Number(repViejo.kg_recibido) === 100 && Number(repViejo.saldo) === 50000, 'el corte en una fecha pasada ignora lo posterior')

console.log('\nEstado de cuenta')
const ec = await rpc(cons, 'estado_cuenta', [loma])
ok(ec.cliente.nombre === 'Cooperativa La Loma' && Number(ec.saldo_inicial) === 0, 'sin fechas, el saldo inicial es cero')
const cargos = ec.movimientos.reduce((s, m) => s + Number(m.cargo ?? 0), 0)
const abonos = ec.movimientos.reduce((s, m) => s + Number(m.abono ?? 0), 0)
ok(cargos - abonos === 700000, 'cargos − abonos = saldo del cliente')
ok(ec.movimientos[0].tipo === 'recibo' && Number(ec.movimientos[0].kg_pergamino) === 100, 'los movimientos van en orden de fecha')
const ecMes = (await como(cons, 'select public.estado_cuenta($1, current_date - 30, current_date) as r', [loma])).rows[0].r
ok(Number(ecMes.saldo_inicial) === 50000 && ecMes.movimientos.length === 3, 'con periodo: saldo anterior y solo sus movimientos')
ok(!!(await falla(rpc(oper, 'estado_cuenta', [loma]))), 'el operador no ve estados de cuenta')
ok(
  (await comoServidor(`select nombre_negocio from public.configuracion`)).rows[0].nombre_negocio === 'Trilla de café',
  'la configuración tiene nombre del negocio para los impresos',
)

console.log(`\n${pruebas - fallas}/${pruebas} pruebas correctas`)
process.exit(fallas ? 1 : 0)
