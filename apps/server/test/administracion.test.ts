import {
  ClienteSchema,
  CotizacionIngresoRespuestaSchema,
  MovimientoCajaSchema,
  PrecioEspecialClienteSchema,
  RUTAS,
  RangoSchema,
  TurnoSchema,
  UsuarioSchema,
} from "@apurimeno/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { efectivo, prepararEntorno, ruta, type Entorno } from "./entorno.js";

let e: Entorno;
let cajero: string;
let admin: string;

beforeEach(async () => {
  e = await prepararEntorno();
  cajero = await e.login("cajero");
  admin = await e.login("admin");
});
afterEach(() => e.cerrar());

const precioRuta = (clienteId: string, habitacionId: string) =>
  RUTAS.precioEspecialCliente.replace(":id", clienteId).replace(":habitacionId", habitacionId);

async function crearCliente(token: string, documento: string | null, nombre: string | null): Promise<string> {
  const r = await e.llamar("POST", RUTAS.clientes, token, { documento, nombre });
  expect(r.statusCode).toBe(201);
  return ClienteSchema.parse(r.json()).id;
}

describe("Clientes (CU-09, RF-34)", () => {
  it("el cajero registra y busca clientes por documento o nombre parcial", async () => {
    await crearCliente(cajero, "45678912", "Juan Pérez");
    await crearCliente(cajero, null, "Juana Ríos");
    await crearCliente(cajero, "11112222", null);
    const porNombre = ClienteSchema.array().parse((await e.llamar("GET", `${RUTAS.clientes}?q=juan`, cajero)).json());
    expect(porNombre.map((c) => c.nombre)).toEqual(["Juan Pérez", "Juana Ríos"]);
    const porDocumento = ClienteSchema.array().parse((await e.llamar("GET", `${RUTAS.clientes}?q=4567`, cajero)).json());
    expect(porDocumento.map((c) => c.documento)).toEqual(["45678912"]);
  });

  it("el documento es único cuando existe (decisión 17); sin documento se repite sin problema", async () => {
    await crearCliente(cajero, "45678912", "Juan Pérez");
    expect((await e.llamar("POST", RUTAS.clientes, cajero, { documento: "45678912", nombre: "Otro" })).json()).toMatchObject({
      codigo: "VALIDACION",
    });
    await crearCliente(cajero, null, "Sin documento");
    await crearCliente(cajero, null, "Sin documento");
  });

  it("un cliente necesita documento o nombre; Limpieza no ve clientes", async () => {
    expect((await e.llamar("POST", RUTAS.clientes, cajero, { documento: null, nombre: null })).statusCode).toBe(400);
    expect((await e.llamar("GET", RUTAS.clientes, await e.login("limpieza"))).statusCode).toBe(403);
  });

  it("editar corrige los datos del cliente", async () => {
    const id = await crearCliente(cajero, null, "Juan");
    const r = await e.llamar("PUT", ruta(RUTAS.cliente, id), cajero, { documento: "45678912", nombre: "Juan Pérez" });
    expect(ClienteSchema.parse(r.json())).toEqual({ id, documento: "45678912", nombre: "Juan Pérez" });
    expect((await e.llamar("PUT", ruta(RUTAS.cliente, "no-existe"), cajero, { documento: null, nombre: "x" })).statusCode).toBe(404);
  });
});

describe("Precios especiales (CU-08; RF-16 a RF-18; RN-14 a RN-16)", () => {
  it("alta, aplicación automática en la cotización, edición y eliminación, todo auditado", async () => {
    const clienteId = await crearCliente(admin, "45678912", "Juan Pérez");
    const alta = await e.llamar("POST", ruta(RUTAS.preciosEspecialesCliente, clienteId), admin, { habitacionId: "hab-205", precio: 5000 });
    expect(alta.statusCode).toBe(201);
    expect(PrecioEspecialClienteSchema.parse(alta.json())).toMatchObject({ clienteId, habitacionId: "hab-205", precio: 5000, creadoPorId: "usuario-admin" });

    const cotizar = async () =>
      CotizacionIngresoRespuestaSchema.parse(
        (await e.llamar("POST", RUTAS.cotizarIngreso, cajero, { habitacionId: "hab-205", clienteId, horasAdicionalesAlIngreso: 0 })).json(),
      );
    expect(await cotizar()).toMatchObject({ origenPrecio: "PRECIO_ESPECIAL", total: 5000 });

    const editado = await e.llamar("PUT", precioRuta(clienteId, "hab-205"), admin, { precio: 4500 });
    expect(PrecioEspecialClienteSchema.parse(editado.json()).precio).toBe(4500);
    expect((await cotizar()).total).toBe(4500);

    expect((await e.llamar("DELETE", precioRuta(clienteId, "hab-205"), admin)).statusCode).toBe(204);
    expect(await cotizar()).toMatchObject({ origenPrecio: "LISTA", total: 4000 });
    expect((await e.llamar("GET", ruta(RUTAS.preciosEspecialesCliente, clienteId), admin)).json()).toEqual([]);

    const acciones = (await e.prisma.registroAuditoria.findMany({ where: { tipoEntidad: "PRECIO_ESPECIAL_CLIENTE" }, orderBy: { ocurridoEn: "asc" } })).map(
      (r) => r.accion,
    );
    expect(acciones).toEqual(["PRECIO_ESPECIAL_CREADO", "PRECIO_ESPECIAL_EDITADO", "PRECIO_ESPECIAL_ELIMINADO"]);
  });

  it("una segunda alta para la misma combinación → 422 CLIENT_ROOM_PRICE_ALREADY_EXISTS; otra habitación sí (RN-15)", async () => {
    const clienteId = await crearCliente(admin, "45678912", null);
    const url = ruta(RUTAS.preciosEspecialesCliente, clienteId);
    await e.llamar("POST", url, admin, { habitacionId: "hab-205", precio: 5000 });
    const repetido = await e.llamar("POST", url, admin, { habitacionId: "hab-205", precio: 4000 });
    expect(repetido.statusCode).toBe(422);
    expect(repetido.json()).toMatchObject({ codigo: "CLIENT_ROOM_PRICE_ALREADY_EXISTS" });
    expect((await e.llamar("POST", url, admin, { habitacionId: "hab-105", precio: 4500 })).statusCode).toBe(201);
    expect(PrecioEspecialClienteSchema.array().parse((await e.llamar("GET", url, admin)).json())).toHaveLength(2);
  });

  it("solo client_pricing.manage gestiona precios (RN-16); editar o borrar uno inexistente → 404", async () => {
    const clienteId = await crearCliente(cajero, "45678912", null);
    const url = ruta(RUTAS.preciosEspecialesCliente, clienteId);
    expect((await e.llamar("POST", url, cajero, { habitacionId: "hab-205", precio: 100 })).statusCode).toBe(403);
    expect((await e.llamar("PUT", precioRuta(clienteId, "hab-205"), admin, { precio: 100 })).statusCode).toBe(404);
    expect((await e.llamar("DELETE", precioRuta(clienteId, "hab-205"), admin)).statusCode).toBe(404);
    expect((await e.llamar("POST", url, admin, { habitacionId: "hab-999", precio: 100 })).statusCode).toBe(404);
  });
});

describe("Usuarios (CU-23; RN-40, RF-45, RF-63)", () => {
  const nuevo = { nombreUsuario: "maria", contrasena: "clave-segura", rangoIds: ["rango-cajero"] };

  it("alta: la cuenta inicia sesión con su contraseña, que nunca vuelve ni se audita", async () => {
    const r = await e.llamar("POST", RUTAS.usuarios, admin, nuevo);
    expect(r.statusCode).toBe(201);
    expect(UsuarioSchema.parse(r.json())).toMatchObject({ nombreUsuario: "maria", activo: true, rangoIds: ["rango-cajero"] });
    expect(r.body).not.toContain("clave-segura");
    const login = await e.llamar("POST", RUTAS.login, null, { nombreUsuario: "maria", contrasena: "clave-segura" });
    expect(login.statusCode).toBe(200);
    const auditoria = JSON.stringify(await e.prisma.registroAuditoria.findMany({ where: { tipoEntidad: "USUARIO" } }));
    expect(auditoria).toContain("USUARIO_CREADO");
    expect(auditoria).not.toContain("clave-segura");
    expect((await e.llamar("POST", RUTAS.usuarios, admin, nuevo)).json()).toMatchObject({ codigo: "VALIDACION" });
  });

  it("desactivar corta el acceso en la siguiente solicitud, aun con token vigente, sin borrar la cuenta (RF-45)", async () => {
    const id = UsuarioSchema.parse((await e.llamar("POST", RUTAS.usuarios, admin, nuevo)).json()).id;
    const token = await (async () => {
      const r = await e.llamar("POST", RUTAS.login, null, { nombreUsuario: "maria", contrasena: "clave-segura" });
      return r.json<{ token: string }>().token;
    })();
    expect((await e.llamar("POST", RUTAS.abrirTurno, token, { efectivoInicial: 0 })).statusCode).toBe(201);

    const editado = await e.llamar("PUT", ruta(RUTAS.usuario, id), admin, { nombreUsuario: "maria", activo: false, rangoIds: ["rango-cajero"] });
    expect(UsuarioSchema.parse(editado.json()).activo).toBe(false);
    expect((await e.llamar("GET", RUTAS.productos, token)).statusCode).toBe(401);
    expect((await e.llamar("POST", RUTAS.login, null, { nombreUsuario: "maria", contrasena: "clave-segura" })).statusCode).toBe(401);
    expect(await e.prisma.usuario.findUnique({ where: { id } })).not.toBeNull();
    expect(await e.prisma.registroAuditoria.findFirst({ where: { accion: "USUARIO_DESACTIVADO", entidadId: id } })).not.toBeNull();
  });

  it("cambiar rangos rige en la siguiente operación (RF-63) y queda auditado", async () => {
    const id = UsuarioSchema.parse((await e.llamar("POST", RUTAS.usuarios, admin, nuevo)).json()).id;
    const token = (await e.llamar("POST", RUTAS.login, null, { nombreUsuario: "maria", contrasena: "clave-segura" })).json<{ token: string }>().token;
    expect((await e.llamar("GET", RUTAS.habitacionesPendientesLimpieza, token)).statusCode).toBe(403);
    await e.llamar("PUT", ruta(RUTAS.usuario, id), admin, { nombreUsuario: "maria", activo: true, rangoIds: ["rango-cajero", "rango-limpieza"] });
    expect((await e.llamar("GET", RUTAS.habitacionesPendientesLimpieza, token)).statusCode).toBe(200);
    expect(await e.prisma.registroAuditoria.findFirst({ where: { accion: "USUARIO_RANGOS_ASIGNADOS", entidadId: id } })).toMatchObject({
      valorPrevio: { rangoIds: ["rango-cajero"] },
    });
  });

  it("cambiar la contraseña: la anterior deja de servir", async () => {
    const id = UsuarioSchema.parse((await e.llamar("POST", RUTAS.usuarios, admin, nuevo)).json()).id;
    expect((await e.llamar("PUT", ruta(RUTAS.contrasenaUsuario, id), admin, { contrasena: "corta" })).statusCode).toBe(400);
    expect((await e.llamar("PUT", ruta(RUTAS.contrasenaUsuario, id), admin, { contrasena: "otra-clave-larga" })).statusCode).toBe(204);
    expect((await e.llamar("POST", RUTAS.login, null, { nombreUsuario: "maria", contrasena: "clave-segura" })).statusCode).toBe(401);
    expect((await e.llamar("POST", RUTAS.login, null, { nombreUsuario: "maria", contrasena: "otra-clave-larga" })).statusCode).toBe(200);
  });

  it("rangos desconocidos → 404; solo users.manage administra usuarios", async () => {
    expect((await e.llamar("POST", RUTAS.usuarios, admin, { ...nuevo, rangoIds: ["rango-x"] })).statusCode).toBe(404);
    expect((await e.llamar("GET", RUTAS.usuarios, cajero)).statusCode).toBe(403);
    expect((await e.llamar("POST", RUTAS.usuarios, cajero, nuevo)).statusCode).toBe(403);
    const rangos = RangoSchema.array().parse((await e.llamar("GET", RUTAS.rangos, admin)).json());
    expect(rangos.map((r) => r.id).sort()).toEqual(["rango-administrador", "rango-cajero", "rango-limpieza"]);
    const usuarios = UsuarioSchema.array().parse((await e.llamar("GET", RUTAS.usuarios, admin)).json());
    expect(usuarios.map((u) => u.nombreUsuario)).toEqual(["admin", "cajero", "limpieza"]);
  });
});

describe("Movimientos manuales de caja (CU-18, RF-42)", () => {
  it("entran en el efectivo esperado del arqueo (RN-33) y quedan auditados con motivo", async () => {
    await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 10000 });
    await e.llamar(
      "POST",
      RUTAS.registrarIngreso,
      cajero,
      { habitacionId: "hab-205", clienteId: null, horasAdicionalesAlIngreso: 0, ajuste: null, pagos: [efectivo(4000)] },
      "clave-caja-1",
    );
    const retiro = await e.llamar("POST", RUTAS.movimientosCaja, cajero, { tipo: "RETIRO", monto: 3000, motivo: "pago de agua" }, "clave-caja-2");
    expect(retiro.statusCode).toBe(201);
    expect(MovimientoCajaSchema.parse(retiro.json())).toMatchObject({ tipo: "RETIRO", monto: 3000, motivo: "pago de agua" });
    await e.llamar("POST", RUTAS.movimientosCaja, cajero, { tipo: "INGRESO", monto: 500, motivo: "sencillo" }, "clave-caja-3");

    const cierre = TurnoSchema.parse((await e.llamar("POST", RUTAS.cerrarTurno, cajero, { efectivoContado: 11500, comentario: null })).json());
    expect(cierre).toMatchObject({ efectivoEsperado: 10000 + 4000 - 3000 + 500, diferencia: 0 });
    expect(await e.prisma.registroAuditoria.count({ where: { accion: "MOVIMIENTO_CAJA_REGISTRADO" } })).toBe(2);
  });

  it("es idempotente: reintentar con la misma clave no duplica el retiro", async () => {
    await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 10000 });
    const cuerpo = { tipo: "RETIRO", monto: 3000, motivo: "pago de agua" };
    const [a, b] = await Promise.all([
      e.llamar("POST", RUTAS.movimientosCaja, cajero, cuerpo, "clave-caja-4"),
      e.llamar("POST", RUTAS.movimientosCaja, cajero, cuerpo, "clave-caja-4"),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    expect(a.json<{ id: string }>().id).toBe(b.json<{ id: string }>().id);
    const repetido = await e.llamar("POST", RUTAS.movimientosCaja, cajero, cuerpo, "clave-caja-4");
    expect(repetido.headers["idempotent-replayed"]).toBe("true");
    expect(await e.prisma.movimientoCaja.count()).toBe(1);
    // La misma clave usada por otra persona no reproduce el movimiento ajeno.
    await e.llamar("POST", RUTAS.abrirTurno, admin, { efectivoInicial: 0 });
    expect((await e.llamar("POST", RUTAS.movimientosCaja, admin, cuerpo, "clave-caja-4")).statusCode).toBe(409);
  });

  it("exige motivo, turno abierto e idempotency-key; Limpieza no mueve caja", async () => {
    const cuerpo = { tipo: "RETIRO", monto: 3000, motivo: "pago de agua" };
    expect((await e.llamar("POST", RUTAS.movimientosCaja, cajero, cuerpo, "clave-caja-5")).json()).toMatchObject({ codigo: "SHIFT_NOT_OPEN" });
    await e.llamar("POST", RUTAS.abrirTurno, cajero, { efectivoInicial: 0 });
    expect((await e.llamar("POST", RUTAS.movimientosCaja, cajero, { ...cuerpo, motivo: "  " }, "clave-caja-6")).json()).toMatchObject({
      codigo: "REASON_REQUIRED",
    });
    expect((await e.llamar("POST", RUTAS.movimientosCaja, cajero, cuerpo)).statusCode).toBe(400);
    expect((await e.llamar("POST", RUTAS.movimientosCaja, await e.login("limpieza"), cuerpo, "clave-caja-7")).statusCode).toBe(403);
    expect(await e.prisma.movimientoCaja.count()).toBe(0);
  });
});
