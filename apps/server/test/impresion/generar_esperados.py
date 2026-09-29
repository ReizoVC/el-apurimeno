"""Genera los bytes ESC/POS esperados de cada caso de casos.json, uno por archivo .hex.

Es una implementación aparte de apps/server/src/impresion/escpos.ts (e imagen.ts), a propósito: usa los códecs
cp850 y cp1252 de Python, decodifica el PNG del logotipo con zlib por su cuenta y escribe los comandos a mano desde
el manual ESC/POS. Si ambas coinciden byte a byte, la codificación es correcta. Cada línea del .hex es un comando,
una línea impresa o una fila del logotipo, para leer el diff.
"""
import json
import pathlib
import zlib

AQUI = pathlib.Path(__file__).parent
RECURSOS = AQUI.parent.parent / "recursos"
CODEC = {"PC850": "cp850", "WPC1252": "cp1252"}
ESC_T = {"PC850": 2, "WPC1252": 16}
SUSTITUTOS = {"—": "-", "–": "-", "“": '"', "”": '"', "‘": "'", "’": "'", "…": "...", "€": "EUR"}


def texto(t: str, pagina: str) -> bytes:
    for original, ascii_ in SUSTITUTOS.items():
        if pagina == "WPC1252" and original == "€":
            continue
        t = t.replace(original, ascii_)
    return t.encode(CODEC[pagina])


def png_a_raster(ruta: pathlib.Path) -> tuple[int, list[bytes]]:
    """Decodifica un PNG de 8 bits por muestra (gris, RGB, gris + alfa o RGBA) y lo lleva a filas de un bit para
    GS v 0: el bit más alto a la izquierda, 1 = negro (luminancia < 128 y alfa >= 128)."""
    datos = ruta.read_bytes()
    assert datos[:8] == b"\x89PNG\r\n\x1a\n"
    pos, idat = 8, b""
    while pos < len(datos):
        largo = int.from_bytes(datos[pos : pos + 4], "big")
        tipo, contenido = datos[pos + 4 : pos + 8], datos[pos + 8 : pos + 8 + largo]
        if tipo == b"IHDR":
            ancho, alto = int.from_bytes(contenido[0:4], "big"), int.from_bytes(contenido[4:8], "big")
            bits, color, entrelazado = contenido[8], contenido[9], contenido[12]
        elif tipo == b"IDAT":
            idat += contenido
        pos += 12 + largo
    canales = {0: 1, 2: 3, 4: 2, 6: 4}[color]
    assert bits == 8 and entrelazado == 0
    crudo, fila_bytes = zlib.decompress(idat), ancho * canales
    anterior, filas = bytearray(fila_bytes), []
    for y in range(alto):
        filtro = crudo[y * (fila_bytes + 1)]
        fila = bytearray(crudo[y * (fila_bytes + 1) + 1 : (y + 1) * (fila_bytes + 1)])
        for i in range(fila_bytes):
            a = fila[i - canales] if i >= canales else 0
            b, c = anterior[i], anterior[i - canales] if i >= canales else 0
            if filtro == 1:
                fila[i] = (fila[i] + a) & 0xFF
            elif filtro == 2:
                fila[i] = (fila[i] + b) & 0xFF
            elif filtro == 3:
                fila[i] = (fila[i] + (a + b) // 2) & 0xFF
            elif filtro == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                fila[i] = (fila[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 0xFF
        anterior = fila
        salida = bytearray((ancho + 7) // 8)
        for x in range(ancho):
            m = fila[x * canales : (x + 1) * canales]
            gris = m[0] if canales <= 2 else round(0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2])
            alfa = m[1] if canales == 2 else m[3] if canales == 4 else 255
            if gris < 128 and alfa >= 128:
                salida[x // 8] |= 0x80 >> (x % 8)
        filas.append(bytes(salida))
    return (ancho + 7) // 8, filas


def comprobante(caso: dict) -> list[tuple[str, bytes]]:
    pagina = caso["paginaCodigos"]
    partes = [
        ("ESC @", b"\x1b\x40"),
        (f"ESC t {ESC_T[pagina]}", bytes([0x1B, 0x74, ESC_T[pagina]])),
        ("ESC M 0 (fuente A)", b"\x1b\x4d\x00"),
    ]
    if "logo" in caso:
        x, filas = png_a_raster(RECURSOS / caso["logo"])
        y = len(filas)
        partes.append(("ESC a 1 (centrar)", b"\x1b\x61\x01"))
        partes.append((f"GS v 0: {x} bytes por fila, {y} filas", bytes([0x1D, 0x76, 0x30, 0, x & 0xFF, x >> 8, y & 0xFF, y >> 8])))
        partes += [(f"fila {n}", fila) for n, fila in enumerate(filas)]
        partes.append(("ESC a 0", b"\x1b\x61\x00"))
        partes.append(("ESC J 8 (1 mm)", b"\x1b\x4a\x08"))
    for linea in caso["lineas"]:
        estilo, contenido = linea["estilo"], linea["texto"]
        b = b""
        if estilo != "normal":
            b += b"\x1b\x45\x01"
        if estilo == "grande":
            b += b"\x1d\x21\x01"
        b += texto(contenido, pagina)
        if estilo == "grande":
            b += b"\x1d\x21\x00"
        if estilo != "normal":
            b += b"\x1b\x45\x00"
        partes.append((contenido.strip() or "(línea)", b + b"\n"))
    partes.append(("ESC d 4", b"\x1b\x64\x04"))
    partes.append(("GS V 1", b"\x1d\x56\x01"))
    return partes


for caso in json.loads((AQUI / "casos.json").read_text(encoding="utf-8")):
    lineas = [f"{b.hex(' ')}  # {etiqueta}" for etiqueta, b in comprobante(caso)]
    (AQUI / f"{caso['nombre']}.hex").write_text("\n".join(lineas) + "\n", encoding="utf-8")
    print("Escrito", caso["nombre"])
