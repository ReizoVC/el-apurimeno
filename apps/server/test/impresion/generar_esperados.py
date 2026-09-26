"""Genera los bytes ESC/POS esperados de cada caso de casos.json, uno por archivo .hex.

Es una implementación aparte de apps/server/src/impresion/escpos.ts, a propósito: usa los códecs cp850 y
cp1252 de Python y escribe los comandos a mano desde el manual ESC/POS. Si ambas coinciden byte a byte,
la codificación es correcta. Cada línea del .hex es un comando o una línea impresa, para leer el diff.
"""
import json
import pathlib

AQUI = pathlib.Path(__file__).parent
CODEC = {"PC850": "cp850", "WPC1252": "cp1252"}
ESC_T = {"PC850": 2, "WPC1252": 16}
SUSTITUTOS = {"—": "-", "–": "-", "“": '"', "”": '"', "‘": "'", "’": "'", "…": "...", "€": "EUR"}


def texto(t: str, pagina: str) -> bytes:
    for original, ascii_ in SUSTITUTOS.items():
        if pagina == "WPC1252" and original == "€":
            continue
        t = t.replace(original, ascii_)
    return t.encode(CODEC[pagina])


def comprobante(caso: dict) -> list[tuple[str, bytes]]:
    pagina = caso["paginaCodigos"]
    partes = [("ESC @", b"\x1b\x40"), (f"ESC t {ESC_T[pagina]}", bytes([0x1B, 0x74, ESC_T[pagina]]))]
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
