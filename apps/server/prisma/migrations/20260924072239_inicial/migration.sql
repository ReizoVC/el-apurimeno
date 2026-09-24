-- CreateTable
CREATE TABLE "Habitacion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "numero" TEXT NOT NULL,
    "descripcion" TEXT,
    "precioBase" INTEGER NOT NULL,
    "estado" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documento" TEXT,
    "nombre" TEXT
);

-- CreateTable
CREATE TABLE "PrecioEspecialCliente" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clienteId" TEXT NOT NULL,
    "habitacionId" TEXT NOT NULL,
    "precio" INTEGER NOT NULL,
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" DATETIME NOT NULL,
    CONSTRAINT "PrecioEspecialCliente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PrecioEspecialCliente_habitacionId_fkey" FOREIGN KEY ("habitacionId") REFERENCES "Habitacion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PrecioEspecialCliente_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Alquiler" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "habitacionId" TEXT NOT NULL,
    "clienteId" TEXT,
    "turnoId" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "ingresoEn" DATETIME NOT NULL,
    "salidaProgramadaEn" DATETIME NOT NULL,
    "cortesiaConsumida" BOOLEAN NOT NULL,
    "origenPrecio" TEXT NOT NULL,
    "precioHabitacionAplicado" INTEGER NOT NULL,
    "horasAdicionalesAlIngreso" INTEGER NOT NULL,
    "parametrosAplicados" JSONB NOT NULL,
    "cerradoEn" DATETIME,
    "cerradoPorId" TEXT,
    "salidaSinPago" BOOLEAN NOT NULL,
    "motivoSalidaSinPago" TEXT,
    CONSTRAINT "Alquiler_habitacionId_fkey" FOREIGN KEY ("habitacionId") REFERENCES "Habitacion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Alquiler_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Alquiler_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "Turno" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Alquiler_cerradoPorId_fkey" FOREIGN KEY ("cerradoPorId") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HoraAdicional" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "alquilerId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "salidaAnterior" DATETIME NOT NULL,
    "salidaNueva" DATETIME NOT NULL,
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" DATETIME NOT NULL,
    CONSTRAINT "HoraAdicional_alquilerId_fkey" FOREIGN KEY ("alquilerId") REFERENCES "Alquiler" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "HoraAdicional_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "HoraAdicional_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "numero" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "origen" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "turnoId" TEXT NOT NULL,
    "alquilerId" TEXT,
    "habitacionReferenciaId" TEXT,
    "ticketOriginalId" TEXT,
    "total" INTEGER NOT NULL,
    "ajustePuntual" JSONB,
    "anulacion" JSONB,
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" DATETIME NOT NULL,
    "claveIdempotencia" TEXT,
    CONSTRAINT "Ticket_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "Turno" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Ticket_alquilerId_fkey" FOREIGN KEY ("alquilerId") REFERENCES "Alquiler" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Ticket_habitacionReferenciaId_fkey" FOREIGN KEY ("habitacionReferenciaId") REFERENCES "Habitacion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Ticket_ticketOriginalId_fkey" FOREIGN KEY ("ticketOriginalId") REFERENCES "Ticket" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Ticket_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LineaTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "posicion" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precioUnitario" INTEGER NOT NULL,
    "importe" INTEGER NOT NULL,
    "productoId" TEXT,
    CONSTRAINT "LineaTicket_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LineaTicket_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Pago" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "posicion" INTEGER NOT NULL,
    "metodoPagoId" TEXT NOT NULL,
    "monto" INTEGER NOT NULL,
    "referencia" TEXT,
    "montoRecibido" INTEGER,
    "vuelto" INTEGER,
    CONSTRAINT "Pago_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Pago_metodoPagoId_fkey" FOREIGN KEY ("metodoPagoId") REFERENCES "MetodoPago" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MetodoPago" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nombre" TEXT NOT NULL,
    "afectaCaja" BOOLEAN NOT NULL,
    "requiereReferencia" BOOLEAN NOT NULL,
    "activo" BOOLEAN NOT NULL
);

-- CreateTable
CREATE TABLE "Turno" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "usuarioId" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "abiertoEn" DATETIME NOT NULL,
    "efectivoInicial" INTEGER NOT NULL,
    "cerradoEn" DATETIME,
    "cerradoPorId" TEXT,
    "cierreForzado" BOOLEAN NOT NULL,
    "efectivoContado" INTEGER,
    "efectivoEsperado" INTEGER,
    "diferencia" INTEGER,
    "comentarioCierre" TEXT,
    CONSTRAINT "Turno_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Turno_cerradoPorId_fkey" FOREIGN KEY ("cerradoPorId") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MovimientoCaja" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "turnoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "monto" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" DATETIME NOT NULL,
    CONSTRAINT "MovimientoCaja_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "Turno" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MovimientoCaja_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CategoriaProducto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nombre" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Producto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "categoriaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigoBarras" TEXT,
    "precioHuesped" INTEGER NOT NULL,
    "precioPublico" INTEGER NOT NULL,
    "controlaStock" BOOLEAN NOT NULL,
    "stock" INTEGER NOT NULL,
    "activo" BOOLEAN NOT NULL,
    CONSTRAINT "Producto_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "CategoriaProducto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MovimientoInventario" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "ticketId" TEXT,
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" DATETIME NOT NULL,
    CONSTRAINT "MovimientoInventario_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MovimientoInventario_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MovimientoInventario_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nombreUsuario" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL,
    "contrasenaHash" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "UsuarioRango" (
    "usuarioId" TEXT NOT NULL,
    "rangoId" TEXT NOT NULL,

    PRIMARY KEY ("usuarioId", "rangoId"),
    CONSTRAINT "UsuarioRango_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UsuarioRango_rangoId_fkey" FOREIGN KEY ("rangoId") REFERENCES "Rango" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Rango" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nombre" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "RangoPermiso" (
    "rangoId" TEXT NOT NULL,
    "permiso" TEXT NOT NULL,

    PRIMARY KEY ("rangoId", "permiso"),
    CONSTRAINT "RangoPermiso_rangoId_fkey" FOREIGN KEY ("rangoId") REFERENCES "Rango" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RegistroAuditoria" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ocurridoEn" DATETIME NOT NULL,
    "usuarioId" TEXT,
    "accion" TEXT NOT NULL,
    "tipoEntidad" TEXT NOT NULL,
    "entidadId" TEXT,
    "valorPrevio" JSONB,
    "valorNuevo" JSONB,
    "motivo" TEXT,
    CONSTRAINT "RegistroAuditoria_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CodigoAutorizacion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "codigo" TEXT NOT NULL,
    "operacion" TEXT NOT NULL,
    "generadoPorId" TEXT NOT NULL,
    "generadoEn" DATETIME NOT NULL,
    "expiraEn" DATETIME NOT NULL,
    "usadoEn" DATETIME,
    "usadoPorId" TEXT,
    "ticketId" TEXT,
    CONSTRAINT "CodigoAutorizacion_generadoPorId_fkey" FOREIGN KEY ("generadoPorId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CodigoAutorizacion_usadoPorId_fkey" FOREIGN KEY ("usadoPorId") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CodigoAutorizacion_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrabajoImpresion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "esCopia" BOOLEAN NOT NULL,
    "creadoEn" DATETIME NOT NULL,
    CONSTRAINT "TrabajoImpresion_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConfiguracionGlobal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "parametrosAlquiler" JSONB NOT NULL,
    "comprobante" JSONB NOT NULL,
    "impresora" JSONB NOT NULL,
    "permitirStockNegativo" BOOLEAN NOT NULL,
    "minutosVigenciaCodigoAutorizacion" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Habitacion_numero_key" ON "Habitacion"("numero");

-- CreateIndex
CREATE INDEX "Cliente_documento_idx" ON "Cliente"("documento");

-- CreateIndex
CREATE INDEX "Cliente_nombre_idx" ON "Cliente"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "PrecioEspecialCliente_clienteId_habitacionId_key" ON "PrecioEspecialCliente"("clienteId", "habitacionId");

-- CreateIndex
CREATE INDEX "Alquiler_habitacionId_estado_idx" ON "Alquiler"("habitacionId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "Alquiler_habitacionId_abierto_key" ON "Alquiler"("habitacionId") WHERE "estado" = 'ABIERTO';

-- CreateIndex
CREATE UNIQUE INDEX "HoraAdicional_ticketId_key" ON "HoraAdicional"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_numero_key" ON "Ticket"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_ticketOriginalId_key" ON "Ticket"("ticketOriginalId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_claveIdempotencia_key" ON "Ticket"("claveIdempotencia");

-- CreateIndex
CREATE INDEX "Ticket_turnoId_idx" ON "Ticket"("turnoId");

-- CreateIndex
CREATE UNIQUE INDEX "LineaTicket_ticketId_posicion_key" ON "LineaTicket"("ticketId", "posicion");

-- CreateIndex
CREATE UNIQUE INDEX "Pago_ticketId_posicion_key" ON "Pago"("ticketId", "posicion");

-- CreateIndex
CREATE UNIQUE INDEX "MetodoPago_nombre_key" ON "MetodoPago"("nombre");

-- CreateIndex
CREATE INDEX "Turno_usuarioId_estado_idx" ON "Turno"("usuarioId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "Turno_usuarioId_abierto_key" ON "Turno"("usuarioId") WHERE "estado" = 'ABIERTO';

-- CreateIndex
CREATE UNIQUE INDEX "CategoriaProducto_nombre_key" ON "CategoriaProducto"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Producto_codigoBarras_key" ON "Producto"("codigoBarras");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_nombreUsuario_key" ON "Usuario"("nombreUsuario");

-- CreateIndex
CREATE UNIQUE INDEX "Rango_nombre_key" ON "Rango"("nombre");

-- CreateIndex
CREATE INDEX "RegistroAuditoria_ocurridoEn_idx" ON "RegistroAuditoria"("ocurridoEn");

-- CreateIndex
CREATE UNIQUE INDEX "CodigoAutorizacion_ticketId_key" ON "CodigoAutorizacion"("ticketId");
