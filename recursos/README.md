# Recursos de marca

Originales de la identidad del negocio que usan varias apps. Aquí va **una sola copia** de cada original; las apps
no lo leen al ejecutarse, sino que guardan lo que se genera a partir de él, en el formato y la carpeta que cada
herramienta exige (el App Router de Next, Tauri). Así ninguna app duplica el original ni depende de la ruta de otra.

Los archivos que el servidor lee al ejecutarse (el logotipo del comprobante) siguen en `apps/server/recursos/`
(ver `apps/server/README.md`, "Recursos"): son parte del servidor, no de la marca en general.

## Ícono maestro

`icono_maestro_apurimeno_1024.png`: 1024 × 1024, fondo transparente, dibujo negro centrado con el margen de un
ícono y bordes suavizados. Lo entregó la propietaria el 01/10/2026.

`pnpm iconos` (desde la raíz; `generar-iconos.mjs`) genera todos los íconos y reemplaza los anteriores:

| Dónde | Qué | Tamaños |
|---|---|---|
| `apps/web/app`, `apps/cleaning/app`, `apps/owner/app` | `favicon.ico` | 16, 32 y 48 (PNG dentro del ICO) |
| | `icon1.png`, `icon2.png` | 16 y 32 |
| | `apple-icon.png` | 180 (ícono de inicio en iOS) |
| `apps/native/src-tauri/icons` (y `gen/android`) | El juego completo de `tauri icon`: `icon.ico` del ejecutable y la ventana, `icon.icns`, los PNG de Windows Store, Android e iOS | Los de Tauri |

- **Placa blanca:** el dibujo negro sobre transparente casi no se ve en una pestaña en modo oscuro ni en la barra
  de tareas de Windows. Por eso todos los íconos generados lo llevan sobre una placa blanca: redondeada para el
  favicon y el POS, cuadrada para `apple-icon.png`, porque iOS redondea las esquinas por su cuenta y pinta de negro lo
  transparente. El maestro no cambia: la placa la pone el script.
- **Next:** los nombres son los del App Router (`favicon.ico`, `icon*.png`, `apple-icon.png` en `app/`). Next
  agrega solo los `<link rel="icon">` y `<link rel="apple-touch-icon">` con sus tamaños, también en la exportación
  estática de `owner`. Next no reduce una sola imagen a varios tamaños: sirve cada archivo tal cual, por eso el
  script genera uno por tamaño. Ninguna de las tres apps tiene manifiesto de PWA; si alguna lo agrega, los
  íconos de 192 y 512 se suman al script.
- **Tamaños:** los hace `tauri icon` (el CLI que ya usa el POS), así el script no suma dependencias al monorepo. La
  placa y el ICO los arma el script con `node:zlib`.
- **A 16 × 16 el arco del túnel/casa se pierde** (queda una mancha gris). Se aceptó así por ahora. Si hace falta,
  se dibuja una versión simplificada solo para ese tamaño y el script la usa para `icon1.png` y el favicon.
