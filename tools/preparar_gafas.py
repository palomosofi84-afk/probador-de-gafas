"""Descarga la foto frontal de cada montura de Firmoo, quita el fondo blanco
(incluido el blanco dentro de los lentes) y recorta al borde de la montura.
Genera gafas/<id>.png y catalogo.js."""
import io, json, os, sys, urllib.request
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CDN = "https://df5apg8r0m634.cloudfront.net/p"

# tipo (eyeglasses|sunglasses), id, color, nombre, precio COP, precio antes,
# material, género (mujer|hombre|unisex), talla, ancho total mm, hash foto frontal
E, S = "eyeglasses", "sunglasses"
CATALOGO = [
    (E, "9960", "26997", "Judy151", 140000, None, "Metal", "mujer", "54-16-145", 136, "8ceb8f5343d7e107bef25f5dbcd571bc"),
    (E, "13796", "42229", "FM2664", 50000, 150000, "TR", "mujer", "52-17-145", 132, "b330abba9387d205bcfe5f4f2a028f20"),
    (E, "12910", "37172", "Stella20", 89000, 130000, "Acetato", "mujer", "53-16-145", 128, "7c5739d0180a17373f04469eb259ef86"),
    (E, "6405", "15732", "S7879", 79000, 120000, "TR", "hombre", "56-16-145", 136, "a726a6812dae8800b7fd331eefa3d13e"),
    (E, "6692", "16722", "S7781", 120000, None, "Mixto", "unisex", "54-19-150", 136, "90465ea85b56e558199ffe49e0e40716"),
    (E, "6800", "16706", "S0164", 120000, None, "Metal", "mujer", "60-16-144", 138, "ea666884d78882513c43b889c033ea8c"),
    (E, "7792", "19669", "W87069", 69000, 130000, "Metal y TR", "mujer", "53-14-141", 133, "7b6e073722a315dea7c6b41d679e3f30"),
    (E, "9316", "32046", "Grace001", 145000, None, "Acetato", "unisex", "52-21-145", 132, "e7121b144fba506a3f769e13fee0a5bf"),
    (E, "9543", "25440", "Shirley003", 130000, None, "Metal", "mujer", "52-18-142", 132, "ae0837fa71d79abfa40699c9b23feab2"),
    (E, "9838", "26528", "TR48498", 115000, None, "TR", "unisex", "55-18-145", 132, "c3cf7c2a2f65c8ce7717ad5b1efdfb60"),
    (E, "9892", "26751", "AC79346", 79000, 135000, "Acetato", "unisex", "58-16-148", 137, "0793244e70f53b9ff533082bda891995"),
    (E, "10435", "28677", "M67249", 125000, None, "Metal", "mujer", "48-18-135", 130, "52441f2cd33c20e9c7e201fe01d22421"),
    (E, "10708", "33197", "Andrew055", 99000, 130000, "Acetato", "unisex", "52-18-145", 135, "77292593a079919d8050cb2bad560e65"),
    (E, "9820", "26457", "AC19522", 125000, None, "Acetato", "hombre", "55-18-155", 136, "569e7af645e7fae2a90c7edcb3cdcad5"),
    # --- tanda 2 ---
    (E, "11056", "30737", "TR32442", 110000, None, "TR", "unisex", "51-18-140", 127, "ca6ab28e83e7b9473316551deb5d7c67"),
    (E, "4879", "13581", "DBSN62344", 130000, None, "Acetato", "unisex", "49-20-141", 126, "BBn5zxZQLV"),
    (E, "4875", "12165", "YSL1230", 130000, None, "Metal", "unisex", "50-20-138", 130, "qAb8OA9j1S"),
    (E, "8410", "21676", "Grace20210", 150000, None, "Acetato", "unisex", "51-20-145", 131, "63ca54abf01570c53fa60c8405daa7d6"),
    (E, "6238", "15280", "9018R", 120000, None, "TR", "unisex", "54-20-150", 135, "mbTlRo0hs2"),
    (E, "11469", "40456", "TR30466", 99000, 110000, "TR", "unisex", "51-17-145", 138, "26c5abf84a84c08f08ba952c477304ce"),
    (E, "8256", "21216", "M52860", 130000, None, "Metal", "unisex", "54-18-146", 136, "cd24fa7b1d0b185ac785a53a54c34019"),
    (E, "7839", "38488", "D17660", 135000, None, "Acetato", "unisex", "53-23-145", 138, "8fe32e56bcbd11c1b843c74beb831ecc"),
    (E, "8943", "23454", "AC49995", 130000, None, "TR", "mujer", "51-17-145", 126, "bd0111e2eed9daa01279e0cb636349f2"),
    (E, "14250", "42121", "Ath003new", 190000, None, "Acetato y titanio", "mujer", "53-19-154", 130, "882eabe57f44088253110757dce81767"),
    (E, "6851", "16839", "MX96431", 79000, 130000, "Mixto", "mujer", "53-18-151", 140, "f87042f7602db59fe873c717fa4d559f"),
    (E, "14258", "42146", "Ath014new", 150000, None, "Metal", "unisex", "55-16-140", 133, "99a940cfebcd0bae71d51c883b4be696"),
    (E, "12569", "35950", "Oria16", 135000, None, "Acetato", "mujer", "56-17-145", 135, "1bb9a8e8a4f95e263abd6a6e24808497"),
    (E, "11794", "33288", "TR97008", 59000, 110000, "TR", "mujer", "52-18-145", 131, "dff50e48eab202cdd1e3e656972a046f"),
    (E, "7272", "18115", "AC12437", 145000, None, "Acetato", "mujer", "54-16-140", 131, "da69fe236e7b065f4fa51e7f6676f5a5"),
    (E, "13074", "37734", "Joy023", 89000, 145000, "Metal", "mujer", "52-17-145", 133, "eac451b319a03d2d70f17db66b3b145f"),
    (E, "4788", "14148", "S947", 130000, None, "Mixto", "unisex", "51-21-145", 140, "C6g13g4dJW"),
    (E, "5880", "14113", "F18903A", 89000, 150000, "Acetato", "mujer", "51-21-145", 132, "2afFwvToOP"),
    (E, "4703", "32493", "TR33617", 99000, 110000, "TR", "mujer", "53-17-145", 127, "829005c06b996304ab2353a8e27492a3"),
    (E, "11633", "32724", "AC71905", 125000, None, "Acetato", "unisex", "47-21-145", 125, "d6e5d2ca78a761ec888ab8719f0bcb08"),
    (E, "12126", "34387", "TR25182", 115000, None, "TR", "unisex", "49-21-145", 126, "b2bfc070a5a8f2d1a27e197a23aac389"),
    (S, "10291", "29791", "S80302", 69000, 195000, "Acetato", "unisex", "54-20-144", 130, "2718ed76db82db606d923602e4991ae8"),
    (S, "13286", "40871", "Gentle33", 210000, None, "Acetato", "hombre", "51-22-145", 137, "675aa082eb841937d40a40762514d403"),
    (S, "5661", "33704", "OBMT2007", 200000, None, "Acetato", "unisex", "51-17-145", 124, "145ab1bb9fffb5ba4cfbd986a9a4e455"),
    (S, "8279", "24727", "S05022", 195000, None, "Acetato", "mujer", "54-18-145", 130, "cbc4d4eae96843483bf49594c2c540df"),
    (S, "10227", "42427", "S21643", 195000, None, "TR", "mujer", "54-18-152", 133, "2f3598ab500c9d9c24e66a75d4481abf"),
    (S, "11930", "33734", "S00427", 195000, None, "Metal", "unisex", "55-20-147", 136, "c09f300ba58700256f3e30a27d1e4d97"),
]
GENERO = {"mujer": "Mujer", "hombre": "Hombre", "unisex": "Unisex"}


def quitar_fondo(im: Image.Image) -> Image.Image:
    a = np.asarray(im.convert("RGB")).astype(np.float32)
    # "qué tan lejos del blanco" está cada píxel
    lejos = 255.0 - a.min(axis=2)
    sat = a.max(axis=2) - a.min(axis=2)
    d = np.maximum(lejos, sat * 1.2)
    alpha = np.clip((d - 10.0) / 45.0, 0, 1)  # blanco -> transparente, suave en los bordes
    # Las patillas se ven por dentro de los lentes en la foto frontal; puestas
    # sobre una cara se verían raras. Se borran: el hueco de cada lente se
    # "cierra" morfológicamente, y lo opaco que quede dentro es patilla/plaqueta.
    frame = alpha > 0.25
    huecos = ndi.binary_fill_holes(frame) & ~frame
    huecos = ndi.binary_opening(huecos, iterations=3)  # ignora rendijas finas
    w = a.shape[1]
    r = max(8, int(w * 0.018))
    yy, xx = np.ogrid[-r:r + 1, -r:r + 1]
    disco = xx * xx + yy * yy <= r * r
    lente = ndi.binary_closing(huecos, structure=disco)
    lente = ndi.binary_erosion(lente, iterations=4)  # no tocar el aro
    patilla = ndi.binary_dilation(lente & frame, iterations=2) & lente
    alpha[patilla] = 0
    # Quitar el halo blanco de los bordes: el color de un píxel de borde es una
    # mezcla de montura y fondo blanco; se recupera el color de la montura.
    al = alpha[..., None]
    limpio = np.where(al > 0.04, (a - (1 - al) * 255.0) / np.maximum(al, 0.04), a)
    a = np.clip(limpio, 0, 255)
    rgba = np.dstack([a, alpha * 255]).astype(np.uint8)
    out = Image.fromarray(rgba, "RGBA")
    # recortar al contenido visible
    mask = (alpha > 0.35).astype(np.uint8)
    ys, xs = np.nonzero(mask)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    return out.crop((x0, y0, x1 + 1, y1 + 1))


def analizar_3d(gid, ancho_mm, talla):
    """Datos para armar la gafa en 3D a partir de su foto frontal ya recortada:
    altura de la bisagra, grosor y color de la pata, y la máscara de los lentes."""
    im = Image.open(os.path.join(BASE, "gafas", f"{gid}.png")).convert("RGBA")
    a = np.asarray(im).astype(np.float32)
    alpha = a[..., 3] / 255
    h, w = alpha.shape
    mm = ancho_mm / w                       # milímetros por píxel de la imagen
    op = alpha > 0.5
    # Bisagra: lo opaco en el 1,5% de los bordes izquierdo y derecho
    borde = max(3, int(w * 0.015))
    filas = np.nonzero(op[:, :borde].any(1) | op[:, -borde:].any(1))[0]
    if len(filas) == 0:
        filas = np.nonzero(op.any(1))[0]
    # quedarse con el tramo continuo más grande (ignora dijes colgantes)
    tramos = np.split(filas, np.nonzero(np.diff(filas) > 3)[0] + 1)
    tramo = max(tramos, key=len)
    bisagra_y = float(tramo.mean() / h)
    alto_pata = float(np.clip((tramo.max() - tramo.min() + 1) * mm * 0.8, 1.6, 7.5))
    # Color de la pata: píxeles opacos cerca de la bisagra
    zona = np.zeros_like(op)
    zona[:, :int(w * 0.07)] = True
    zona[:, -int(w * 0.07):] = True
    px = a[op & zona][:, :3]
    if len(px) < 20:
        px = a[op][:, :3]
    color = np.median(px, axis=0)
    # Textura de la pata: se "desenrolla" el aro superior de la montura
    # (columna por columna, desde el borde de arriba hacia abajo), así la pata
    # tiene el mismo material: carey, color, brillo del metal...
    cols = np.nonzero(op.any(0))[0]
    top = np.array([np.argmax(op[:, x]) for x in cols])
    runs = []
    for x, y in zip(cols, top):
        col = op[y:, x]
        runs.append(int(np.argmin(col)) if not col.all() else len(col))
    runs = np.array(runs)
    mitad = runs[len(runs) // 5: 4 * len(runs) // 5]
    t = int(np.clip(0.3 * np.median(mitad), 4, 40))   # solo la franja de arriba del aro (sin lente)
    tira = np.zeros((t, len(cols), 3), np.float32)
    for j, (x, y) in enumerate(zip(cols, top)):
        seg = a[y:y + t, x]
        al = seg[:, 3:4] / 255
        tira[:len(seg), j] = seg[:, :3] * al + color * (1 - al)
    Image.fromarray(tira.clip(0, 255).astype(np.uint8)).resize((512, 32), Image.LANCZOS).save(
        os.path.join(BASE, "gafas", f"{gid}_pata.jpg"), quality=88)
    # Máscara de los lentes (para el brillo del vidrio)
    frame = alpha > 0.25
    huecos = ndi.binary_fill_holes(frame) & ~frame
    huecos = ndi.binary_opening(huecos, iterations=3)
    r = max(8, int(w * 0.018))
    yy, xx = np.ogrid[-r:r + 1, -r:r + 1]
    lente = ndi.binary_closing(huecos, structure=xx * xx + yy * yy <= r * r)
    lente = ndi.gaussian_filter(lente.astype(np.float32), 1.2)
    Image.fromarray((lente * 255).astype(np.uint8), "L").save(os.path.join(BASE, "gafas", f"{gid}_lente.png"), optimize=True)
    largo = int(talla.split("-")[2])
    return dict(bisagraY=round(bisagra_y, 3), altoPataMm=round(alto_pata, 1), largoPataMm=largo,
                colorPata=[int(c) for c in color], pata=f"gafas/{gid}_pata.jpg",
                lente=f"gafas/{gid}_lente.png")


def ficha(kind, gid, color, nombre, precio, antes, material, genero, talla, ancho):
    sol = kind == "sunglasses"
    metal = material.lower().startswith("metal") and "TR" not in material
    return dict(**analizar_3d(gid, ancho, talla), metal=metal,
                id=gid, nombre=nombre, precio=precio, antes=antes,
                tipo=f"{material} · {GENERO[genero]}" + (" · Sol" if sol else ""),
                genero=genero, sol=sol, talla=talla, anchoMm=ancho, img=f"gafas/{gid}.png",
                url=f"https://www.firmoo.com.co/{kind}-p-{gid}.html?color={color}")


def main():
    os.makedirs(os.path.join(BASE, "gafas"), exist_ok=True)
    items = []
    for kind, gid, color, nombre, precio, antes, material, genero, talla, ancho, h in CATALOGO:
        destino = os.path.join(BASE, "gafas", f"{gid}.png")
        if os.path.exists(destino) and "--todo" not in sys.argv:
            items.append(ficha(kind, gid, color, nombre, precio, antes, material, genero, talla, ancho))
            continue
        url = f"{CDN}/{gid}/2-{h}.jpg"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        im = Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=30).read()))
        png = quitar_fondo(im)
        png.save(destino, optimize=True)
        items.append(ficha(kind, gid, color, nombre, precio, antes, material, genero, talla, ancho))
        print(gid, nombre, png.size)
    with open(os.path.join(BASE, "catalogo.js"), "w", encoding="utf-8") as f:
        f.write("// Generado por tools/preparar_gafas.py\nwindow.CATALOGO = ")
        json.dump(items, f, ensure_ascii=False, indent=1)
        f.write(";\n")


if __name__ == "__main__":
    main()
