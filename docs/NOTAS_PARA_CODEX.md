# Notas para Codex

Avisos de Claude a Codex sobre trabajo de Codex que se movió o se respaldó. El más reciente va primero.

## 30/09/2026: tus documentos de inventario están respaldados

El checkout `D:\dev\el-apurimeno` es exclusivamente el de producción: debe estar en `main` y sin cambios sin commit,
porque desde ahí corren los servicios de Windows (`CLAUDE.md`, "Flujo de trabajo"). El 30/09 estaba otra vez en la
rama `codex/inventario-actualizacion-progresiva`, con 4 archivos sin commit. Para volver a `main` y actualizar los
servicios, Claude los respaldó sin borrar nada.

**Qué se respaldó** (los 4 archivos, sin cambios; no había código ni cambios en archivos versionados):

- `docs/ESPECIFICACION_INVENTARIO_ADAPTATIVO_FIFO.md` (de la sesión anterior)
- `docs/PLAN_IMPLEMENTACION_INVENTARIO.md` (de la sesión anterior)
- `docs/REVISION_INVENTARIO_COSTO_PROMEDIO_PARA_CLAUDE.md` (nuevo)
- `.codex-remote-attachments/01a0e171-e8ff-70d2-845d-ccd4d2b995a1/c44a9a44-f652-4cd5-98c0-74a982374bc1/1-ESPECIFICACION_INVENTARIO_COSTO_PROMEDIO-2.md`
  (el adjunto)

**Dónde está**, en el repositorio local del PC de Reizo (no en GitHub):

- **Stash:** `7f6679e9464f24e2127675008e5dfea271b2e663`, mensaje `respaldo-codex-inventario-docs-2026-09-30`.
- **Rama local:** `respaldo/codex-inventario-2026-09-30`, que apunta a ese mismo commit, así el respaldo no depende
  de la pila de stash (que comparten todos los worktrees).

**Cómo recuperarlos**, en tu propio worktree o clon, nunca en `D:\dev\el-apurimeno`. Los archivos sin seguimiento
quedaron en el tercer padre del commit del stash (`^3`):

```bash
git checkout 'respaldo/codex-inventario-2026-09-30^3' -- docs/REVISION_INVENTARIO_COSTO_PROMEDIO_PARA_CLAUDE.md
# o los cuatro de una vez:
git checkout 'respaldo/codex-inventario-2026-09-30^3' -- .
```

**Sobre la rama `codex/inventario-actualizacion-progresiva`:** sigue existiendo y no se tocó. Su último commit,
`5f59815 feat(domain): mark receipts printed by the training instance`, no es de Codex. Es de Reizo, del 27/09:
el commit previo al squash del PR #22, y su contenido ya está en `main`. Para seguir con el inventario, conviene
partir de `main` actual en un worktree propio.

**Respaldo anterior (28/09/2026):** stash `b44179c454328f82a140c159dadfc7b3ee0398ef`
(`respaldo-codex-inventario-y-capacitacion-2026-09-28`) y rama `respaldo/codex-inventario-2026-09-28`. Guarda los dos
primeros documentos y cambios sin commit de esa fecha del entorno de capacitación. El entorno de capacitación se
integró después en `main` con el PR #22.
