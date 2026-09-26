// Formatos propios del POS. El dinero y las horas se formatean con @apurimeno/formato.

/** Piso de una habitación, tomado de su número: "205" → "2". Solo para agrupar en pantalla. */
export function pisoDe(numero: string): string {
  return numero.length > 2 ? numero.slice(0, -2) : numero;
}
