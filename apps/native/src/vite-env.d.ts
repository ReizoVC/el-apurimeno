/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL del servidor, p. ej. http://192.168.1.50:3001. Por defecto, http://localhost:3001. */
  readonly VITE_SERVIDOR_URL?: string;
}
