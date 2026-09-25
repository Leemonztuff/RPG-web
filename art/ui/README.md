# art/ui — 素材放置指南 / Guía de colocación de imágenes de UI

UItask.md pendientes: 材质化背景 / bordes decorativos / HUD装饰 / 自定义光标.
Colocar aquí los PNG generados, con estos nombres exactos:

## Archivos esperados

| Archivo | Uso | Especificaciones |
|---|---|---|
| `panel-stone.png` | 材质化背景 — 面板石质纹理 | 512×512, seamless tileable, sin viñeta |
| `panel-leather.png` | 材质化背景 — 皮革/羊皮纸变体 (headers) | 512×512, seamless tileable |
| `frame-ornate.png` | 装饰性边框 — `border-image` 哥特铜框 | 512×512, RGBA, **centro hueco (alpha 0)**, esquinas simétricas para 9-slice |
| `hud-ornaments.png` | HUD哥特装饰填充 — lámina 2×2 | 2列×2行, RGBA transparente: cadenas / medallión demonio / medallión ángel / piedras rúnicas |
| `cursor-steel.png` | 自定义光标 — estado normal (guantelete acero) | 128×128, RGBA, punta cerca de esquina sup-izq (hotspot 2,2) |
| `cursor-gold.png` | 自定义光标 — hover interactivo (latón dorado) | 128×128, misma pose y composición que steel |
| `cursor-fist.png` | 自定义光标 — click (puño cerrado, **opcional**) | 128×128 |

## Requisitos de aceptación (igual que docs/art-coverage.md)

1. **RGBA nativo transparente**: sin fondo pintado negro/blanco/magenta ni cuadros (alpha real 0 en zonas vacías).
2. **Tileado**: probar texturas en una grilla 3×3 sin costuras visibles.
3. **Contraste**: la textura debe leerse oscura; el texto dorado `--text-gold: #c7b377` debe leerse encima con alto contraste.
4. **Luz superior-izquierda** y estilo hand-painted dark fantasy, coherente con el resto de atlas.
5. **Sin texto, marcas de agua ni bordes exteriores** (el marco ornamental es la excepción: sus bordes SÍ son el contenido).

## Integración en curso (2026-09-25)

Integrado via `ui-art.css` (cargado tras style.css en index.html):
- ✅ `panel-stone.jpg` → fondo de `.panel`
- ✅ `panel-leather.jpg` → fondo de `.panel-header`
- ✅ `frame-ornate.jpg` → recortado a `frame-ornate-cut.jpg` (896×896, sin margen blanco) → `border-image` de `.panel`
- ⏳ `panel-parchment.jpg` (muy claro, 202/255) → reserva sin uso
- ⏳ Decoraciones HUD (cadenas/medalliones/runas) → pendiente de generar
- ⏳ Cursores (guantelete normal/hover) → pendiente de generar, punto de conexión preparado en ui-art.css (style.css, no tocar aún)

- Texturas: overlay sobre el gradiente actual → `background: linear-gradient(...), url('art/ui/panel-stone.png') repeat;`
- Marco: `border: 24px solid transparent; border-image: url('art/ui/frame-ornate.png') 96 round;`
- Cursor: redimensionar 128→32px al integrar → `cursor: url('art/ui/cursor-steel-32.png') 2 2, auto;`

⚠️ Al modificar style.css e index.html: actualizar versión del recurso en index.html (regla de AGENTS.md).
