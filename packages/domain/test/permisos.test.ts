import { PERMISOS, RANGOS_INICIALES, type Rango, type Usuario } from "@apurimeno/contracts";
import { describe, expect, it } from "vitest";
import { PERMISO_POR_OPERACION, permisoAjustePuntual, permisosEfectivos, puede, type Operacion } from "../src/index.js";

const rangos: Rango[] = [
  { id: "r-admin", ...RANGOS_INICIALES.ADMINISTRADOR, permisos: [...RANGOS_INICIALES.ADMINISTRADOR.permisos] },
  { id: "r-cajero", ...RANGOS_INICIALES.CAJERO, permisos: [...RANGOS_INICIALES.CAJERO.permisos] },
  { id: "r-limpieza", ...RANGOS_INICIALES.LIMPIEZA, permisos: [...RANGOS_INICIALES.LIMPIEZA.permisos] },
];

function usuario(rangoIds: string[], activo = true): Usuario {
  return { id: "u1", nombreUsuario: "u", activo, rangoIds };
}

const cajero = permisosEfectivos(usuario(["r-cajero"]), rangos);
const limpieza = permisosEfectivos(usuario(["r-limpieza"]), rangos);
const admin = permisosEfectivos(usuario(["r-admin"]), rangos);

describe("RN-41 · rangos configurables sobre permisos fijos", () => {
  it("los permisos efectivos son la unión de los rangos asignados", () => {
    const ambos = permisosEfectivos(usuario(["r-cajero", "r-limpieza"]), rangos);
    expect(ambos).toEqual(expect.arrayContaining(["sales.sell", "cleaning.mark_ready"]));
  });

  it("un usuario desactivado no tiene permisos (RF-45)", () => {
    expect(permisosEfectivos(usuario(["r-admin"], false), rangos)).toEqual([]);
  });

  it("un rango personalizado funciona igual que los iniciales", () => {
    const supervisor: Rango = { id: "r-sup", nombre: "Supervisor", permisos: ["reports.view", "shifts.force_close"] };
    const permisos = permisosEfectivos(usuario(["r-sup"]), [supervisor]);
    expect(puede(permisos, "CONSULTAR_REPORTES")).toBe(true);
    expect(puede(permisos, "VENDER")).toBe(false);
  });

  it("un rango inexistente es un error de datos", () => {
    expect(() => permisosEfectivos(usuario(["r-x"]), rangos)).toThrow(RangeError);
  });
});

describe("RN-16 · solo client_pricing.manage gestiona precios especiales", () => {
  it("el Administrador sí, el Cajero no", () => {
    expect(puede(admin, "GESTIONAR_PRECIO_ESPECIAL")).toBe(true);
    expect(puede(cajero, "GESTIONAR_PRECIO_ESPECIAL")).toBe(false);
  });
});

describe("RN-25 · solo inventory.manage repone mercadería", () => {
  it("el Administrador sí, el Cajero no", () => {
    expect(puede(admin, "REPONER_INVENTARIO")).toBe(true);
    expect(puede(cajero, "REPONER_INVENTARIO")).toBe(false);
  });
});

describe("Ajuste puntual por origen (decisión 9 de contracts)", () => {
  it("habitación y hora adicional usan rentals.*, la tienda usa store.*", () => {
    expect(permisoAjustePuntual("INGRESO_ALQUILER")).toBe("rentals.manual_adjustment");
    expect(permisoAjustePuntual("HORA_ADICIONAL")).toBe("rentals.manual_adjustment");
    expect(permisoAjustePuntual("VENTA_TIENDA")).toBe("store.manual_adjustment");
  });
});

describe("Matriz §22 con los rangos iniciales", () => {
  // [operación, Cajero, Limpieza]; el Administrador puede todo.
  const matriz: [Operacion, boolean, boolean][] = [
    ["ABRIR_TURNO", true, false],
    ["CERRAR_TURNO", true, false],
    ["FORZAR_CIERRE_TURNO", false, false],
    ["REGISTRAR_MOVIMIENTO_CAJA", true, false],
    ["REGISTRAR_INGRESO", true, false],
    ["COBRAR_HORA_ADICIONAL", true, false],
    ["REGISTRAR_SALIDA", true, false],
    ["REGISTRAR_SALIDA_SIN_PAGO", true, false],
    ["AJUSTAR_PRECIO_HABITACION", true, false],
    ["AJUSTAR_PRECIO_TIENDA", true, false],
    ["GESTIONAR_PRECIO_ESPECIAL", false, false],
    ["BUSCAR_CLIENTE", true, false],
    ["REGISTRAR_CLIENTE", true, false],
    ["VENDER", true, false],
    ["REPONER_INVENTARIO", false, false],
    ["GESTIONAR_PRODUCTOS", false, false],
    ["GESTIONAR_HABITACIONES", false, false],
    ["BLOQUEAR_O_REACTIVAR_HABITACION", false, false],
    ["VER_PENDIENTES_LIMPIEZA", false, true],
    ["MARCAR_HABITACION_LISTA", false, true],
    ["REPORTAR_MANTENIMIENTO", false, true],
    ["ANULAR_TICKET", false, false],
    ["ANULAR_TICKET_CON_CODIGO", true, false],
    ["REIMPRIMIR_COMPROBANTE", true, false],
    ["GESTIONAR_USUARIOS", false, false],
    ["GESTIONAR_RANGOS", false, false],
    ["CONSULTAR_AUDITORIA", false, false],
    ["CONSULTAR_REPORTES", false, false],
    ["CONFIGURAR_PARAMETROS", false, false],
    ["CONFIGURAR_METODOS_PAGO", false, false],
    ["CONSULTAR_RESUMEN_REMOTO", false, false],
  ];

  it.each(matriz)("%s → Cajero %s, Limpieza %s", (operacion, esperadoCajero, esperadoLimpieza) => {
    expect(puede(admin, operacion)).toBe(true);
    expect(puede(cajero, operacion)).toBe(esperadoCajero);
    expect(puede(limpieza, operacion)).toBe(esperadoLimpieza);
  });

  it("toda operación usa un permiso del catálogo", () => {
    for (const permiso of Object.values(PERMISO_POR_OPERACION)) expect(PERMISOS).toContain(permiso);
  });
});
