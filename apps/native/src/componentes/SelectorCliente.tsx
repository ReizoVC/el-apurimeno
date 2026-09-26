import { useEffect, useState } from "react";
import type { Cliente } from "@apurimeno/contracts";
import { Button } from "@apurimeno/ui/components/button";
import { Input } from "@apurimeno/ui/components/input";
import { mensajeDe, servidor } from "../lib/servidor";
import { Campo } from "./Campo";

interface Props {
  cliente: Cliente | null;
  onCambio: (cliente: Cliente | null) => void;
}

const nombreDe = (c: Cliente) =>
  [c.nombre, c.documento].filter((v) => v !== null).join(" · ");

/**
 * Cliente del ingreso (CU-04 paso 3, CU-09): opcional. Se busca por documento o nombre (RF-34) o se registra
 * uno nuevo. Identificarlo es lo que permite aplicar un precio especial (RN-14); sin cliente, precio de lista.
 */
export function SelectorCliente({ cliente, onCambio }: Props) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<Cliente[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [documento, setDocumento] = useState("");
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = texto.trim();
    if (q.length < 2) return setResultados([]);
    const id = window.setTimeout(() => {
      servidor
        .buscarClientes(q)
        .then(setResultados, (e: unknown) => setError(mensajeDe(e)));
    }, 250);
    return () => window.clearTimeout(id);
  }, [texto]);

  const registrar = async () => {
    setError(null);
    try {
      const creado = await servidor.crearCliente({
        documento: documento.trim() === "" ? null : documento.trim(),
        nombre: nombre.trim() === "" ? null : nombre.trim(),
      });
      onCambio(creado);
      setNuevo(false);
      setDocumento("");
      setNombre("");
    } catch (e) {
      setError(mensajeDe(e));
    }
  };

  if (cliente !== null) {
    return (
      <div className="flex items-center justify-between rounded-md border bg-background p-2 text-sm">
        <span>
          Cliente: <span className="font-medium">{nombreDe(cliente)}</span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onCambio(null)}
        >
          Quitar
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error !== null && <p className="text-sm text-destructive">{error}</p>}
      {!nuevo ? (
        <>
          <Campo
            etiqueta="Cliente (opcional)"
            ayuda="Documento o nombre. Sin cliente se cobra el precio de lista."
          >
            <Input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Buscar…"
            />
          </Campo>
          {resultados.length > 0 && (
            <ul className="flex flex-col divide-y rounded-md border bg-background text-sm">
              {resultados.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left hover:bg-muted"
                    onClick={() => onCambio(c)}
                  >
                    {nombreDe(c)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            variant="link"
            className="self-start px-0"
            onClick={() => setNuevo(true)}
          >
            Registrar cliente nuevo…
          </Button>
        </>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
          <Campo etiqueta="Documento">
            <Input
              value={documento}
              onChange={(e) => setDocumento(e.target.value)}
            />
          </Campo>
          <Campo
            etiqueta="Nombre"
            ayuda="Al menos uno de los dos. Nunca se imprime en el comprobante (RN-38)."
          >
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </Campo>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={documento.trim() === "" && nombre.trim() === ""}
              onClick={() => void registrar()}
            >
              Registrar
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setNuevo(false)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
