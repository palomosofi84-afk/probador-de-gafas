# Probador de gafas (3D)

Probador virtual: subes una foto o usas la cámara y las gafas se ponen en tu
cara a tamaño real, en 3D (al voltear se ve la pata de lado).

## Cómo abrirlo
1. Abre una terminal (PowerShell) en esta carpeta.
2. Escribe: `python -m http.server 5180`
3. En el navegador (Chrome o Edge) entra a: http://localhost:5180
4. Para cerrarlo, en la terminal presiona Ctrl + C.

(Tiene que abrirse así, con el servidor. Si haces doble clic en index.html, la cámara y el 3D no funcionan.)

## Qué hay en cada archivo
- `index.html`, `estilos.css`: la página y su diseño.
- `probador.js`: foto/cámara, detección de la cara, tamaño real (iris o DP), filtros.
- `gafas3d.js`: las gafas en 3D (frente, patas, lentes, cabeza invisible que tapa lo de atrás).
- `catalogo.js`: la lista de monturas (se genera sola, no editar a mano).
- `gafas/`: las imágenes de cada montura (frente, textura de la pata y máscara del lente).
- `tools/preparar_gafas.py`: descarga y prepara las monturas.

## Agregar o cambiar monturas
Edita la lista `CATALOGO` en `tools/preparar_gafas.py` (una línea por montura) y corre:
`python tools/preparar_gafas.py`
Solo procesa las nuevas. Con `--todo` vuelve a procesar todas.
Necesita Python con: `pip install numpy pillow scipy`

## Para retomarlo con Claude
Abre esta carpeta en Claude Code y dile qué quieres mejorar.

## Ojo
El catálogo actual usa fotos, nombres y precios de firmoo.com.co como demo.
Para publicarlo en internet, usa el catálogo de un cliente o pide permiso a la marca.
