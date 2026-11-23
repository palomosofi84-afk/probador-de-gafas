// Gafas en 3D: el frente es la foto real de la montura (con una curva leve y
// grosor), las patas se arman en 3D con el material del aro, y una cabeza
// invisible tapa lo que queda detrás (la pata del otro lado al voltear).
// Todo el modelo está en milímetros; el origen es el punto medio entre las pupilas,
// +x hacia la derecha de la imagen, +y hacia arriba, +z hacia la cámara.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const ANCLA_Y = 0.46;        // altura de la pupila dentro de la foto de la montura (0 = arriba)
const DIST_VERTICE = 12;     // mm entre el ojo y el lente
const CURVA_R = 190;         // radio de la curva del frente (mm)

export function crearVisor3D(canvas, alCargar = () => {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const escena = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  escena.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  escena.add(new THREE.HemisphereLight(0xffffff, 0x8a7a6a, 0.9));
  const sol = new THREE.DirectionalLight(0xffffff, 1.4);
  sol.position.set(0.3, 1, 1);
  escena.add(sol);

  // Cámara con perspectiva, como una cámara real: lo que está más atrás (las
  // patas) se ve más hacia el centro y queda detrás de la cabeza cuando miras de frente.
  const camara = new THREE.PerspectiveCamera();

  const cargador = new THREE.TextureLoader();
  const tex = (url, srgb = true) => {
    const t = cargador.load(url, () => alCargar());   // volver a pintar cuando llegue la imagen
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };

  // Cabeza y orejas invisibles: solo escriben profundidad, para tapar lo de atrás
  const ocultar = new THREE.MeshBasicMaterial({ colorWrite: false });
  const cabeza = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), ocultar);
  const orejaI = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), ocultar);
  const orejaD = orejaI.clone();
  [cabeza, orejaI, orejaD].forEach((m) => (m.renderOrder = -1));

  const raiz = new THREE.Group();          // sigue la cabeza
  raiz.matrixAutoUpdate = false;
  const interior = new THREE.Group();      // ajuste de altura del usuario
  raiz.add(interior, cabeza, orejaI, orejaD);
  escena.add(raiz);

  const modelos = new Map();
  let actual = null;

  function frenteCurvo(ancho, alto) {
    const g = new THREE.PlaneGeometry(ancho, alto, 48, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      p.setZ(i, -(x * x) / (2 * CURVA_R));
    }
    g.computeVertexNormals();
    return g;
  }

  // Barra entre dos puntos (pata de acetato): caja orientada con su "alto" hacia arriba
  function barra(a, b, grosor, alto, mat) {
    const largo = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.BoxGeometry(grosor, alto, largo), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.lookAt(b.x, b.y, b.z);
    return m;
  }
  // Varilla entre dos puntos (pata de metal)
  function varilla(a, b, radio, mat) {
    const largo = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radio, radio, largo, 12), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return m;
  }

  function construir(g) {
    const grupo = new THREE.Group();
    const im = g._img;   // imagen ya cargada (para la proporción)
    const W = g.anchoMm, H = W * im.naturalHeight / im.naturalWidth;
    const yc = (ANCLA_Y - 0.5) * H;

    // --- Frente: la foto real de la montura, con grosor ---
    const mapa = tex(g.img);
    const geo = frenteCurvo(W, H);
    const capas = g.metal ? 2 : 4;   // el acetato es más grueso
    for (let i = capas - 1; i >= 0; i--) {
      const mat = new THREE.MeshBasicMaterial({
        map: mapa, transparent: true, alphaTest: i === 0 ? 0.04 : 0.45, side: THREE.DoubleSide,
        color: i === 0 ? 0xffffff : new THREE.Color().setScalar(0.62 - i * 0.04),
      });
      const capa = new THREE.Mesh(geo, mat);
      capa.position.set(0, yc, DIST_VERTICE - i * (g.metal ? 0.7 : 1.1));
      capa.renderOrder = 2 + (capas - i);
      grupo.add(capa);
    }

    // --- Lentes: solo reflejos (se suman a la imagen, no la tapan) ---
    const lente = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
      color: 0x000000, roughness: 0.04, metalness: 0, envMapIntensity: 2.2,
      alphaMap: tex(g.lente, false), transparent: true, depthWrite: false, side: THREE.DoubleSide,
      // Solo suma luz (reflejos) y no toca la transparencia del lienzo:
      // así el lente nunca oscurece la cara que hay detrás.
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    }));
    lente.position.set(0, yc, DIST_VERTICE - 0.4);
    lente.renderOrder = 10;
    grupo.add(lente);

    // --- Patas ---
    const xb = W / 2 - 2.5;
    const yb = H * (ANCLA_Y - g.bisagraY);   // altura de la bisagra respecto a las pupilas
    const zb = DIST_VERTICE - (xb * xb) / (2 * CURVA_R) - 1.5;
    const L = g.largoPataMm || 145;
    const alto = g.altoPataMm || 4;
    let matPata, matPunta;
    if (g.metal) {
      matPata = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setRGB(...g.colorPata.map((c) => c / 255), THREE.SRGBColorSpace),
        metalness: 1, roughness: 0.28,
      });
      matPunta = new THREE.MeshStandardMaterial({ color: 0x2a2522, roughness: 0.4 });
    } else {
      const t = tex(g.pata);
      t.wrapS = THREE.RepeatWrapping;
      matPata = new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2 });
      matPunta = matPata;
    }
    const lados = {};
    for (const lado of [-1, 1]) {
      // cada pata con su propio material, para mostrarla solo al voltear hacia ese lado
      const base = matPata.clone(), punta = matPunta === matPata ? base : matPunta.clone();
      for (const mt of new Set([base, punta])) { mt.transparent = true; mt.opacity = 0; }
      lados[lado] = [...new Set([base, punta])];
      const matPata_ = base, matPunta_ = punta;
      const P = [
        new THREE.Vector3(lado * xb, yb, zb),
        new THREE.Vector3(lado * (xb + 2), yb - 1, zb - 25),
        new THREE.Vector3(lado * (xb + 4), yb - 6, zb - (L - 32)),
        new THREE.Vector3(lado * (xb + 4), yb - 22, zb - (L - 10)),
      ];
      if (g.metal) {
        grupo.add(varilla(P[0], P[1], 0.85, matPata_), varilla(P[1], P[2], 0.85, matPata_));
        grupo.add(varilla(P[2], P[3], 1.5, matPunta_));
        // bisagra
        const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3.2, 5), matPata_);
        b.position.copy(P[0]).add(new THREE.Vector3(0, 0, -1.5));
        grupo.add(b);
        for (const p of P.slice(1, 3)) {
          const j = new THREE.Mesh(new THREE.SphereGeometry(0.85, 10, 8), matPata_);
          j.position.copy(p); grupo.add(j);
        }
      } else {
        grupo.add(barra(P[0], P[1], 3.4, alto, matPata_));
        grupo.add(barra(P[1], P[2], 3.0, Math.max(2.2, alto * 0.7), matPata_));
        grupo.add(barra(P[2], P[3], 2.8, Math.max(2.2, alto * 0.6), matPunta_));
      }
    }
    grupo.userData = { xb, zb, yb, L, lados };
    return grupo;
  }

  function modelo(g) {
    if (!g._img || !g._img.naturalWidth) return null;
    if (!modelos.has(g.id)) modelos.set(g.id, construir(g));
    return modelos.get(g.id);
  }

  /**
   * Dibuja las gafas.
   * @param o.W,o.H    tamaño del lienzo en píxeles
   * @param o.pos      punto entre las pupilas en píxeles del lienzo {x,y} (y hacia abajo)
   * @param o.centro   centro óptico de la cámara en píxeles del lienzo {x,y}
   * @param o.focal    distancia focal en píxeles del lienzo
   * @param o.ejes     {x,y,z} vectores de la cabeza en el espacio 3D (y hacia arriba, z hacia la cámara)
   * @param o.esc      píxeles del lienzo por milímetro
   * @param o.gafa     ficha del catálogo (con _img cargada)
   * @param o.ajYmm    ajuste de altura
   * @param o.caraMm   ancho de la cara
   */
  function dibujar(o) {
    if (renderer.domElement.width !== o.W || renderer.domElement.height !== o.H) renderer.setSize(o.W, o.H, false);
    // Cámara en el centro óptico, a la distancia focal; el plano de las pupilas
    // (z = 0) queda 1:1 con los píxeles del lienzo
    const D = o.focal, cx = o.centro.x, cy = -o.centro.y, n = D * 0.05;
    camara.position.set(cx, cy, D);
    camara.updateMatrixWorld();
    camara.projectionMatrix.makePerspective(
      (0 - cx) * n / D, (o.W - cx) * n / D, (0 - cy) * n / D, (-o.H - cy) * n / D, n, D * 6);
    camara.projectionMatrixInverse.copy(camara.projectionMatrix).invert();
    renderer.clear();
    const m = o.gafa && modelo(o.gafa);
    if (!m || !o.pos) return;
    if (actual !== m) { if (actual) interior.remove(actual); interior.add(m); actual = m; }
    interior.position.y = o.ajYmm || 0;
    interior.updateMatrix();

    // cabeza: un poco más angosta que la separación de las patas
    const { xb, zb } = m.userData;
    // (con volumen de pelo; un poco más angosta que las patas para no taparlas
    // del lado que se ve, pero suficiente para esconder la del otro lado)
    // la cabeza llega justo al lado interno de las patas (las patas van pegadas a la cabeza)
    const { L, lados } = m.userData;
    const hx = xb + 1;
    cabeza.scale.set(hx, 122, 104);
    cabeza.position.set(0, -4, zb - 92);
    orejaI.scale.set(9, 30, 18); orejaD.scale.copy(orejaI.scale);
    orejaI.position.set(-(xb + 9), -22, zb - (L - 22));
    orejaD.position.set(xb + 9, -22, zb - (L - 22));
    // Patas: de frente no se ven; aparecen suavemente al voltear (la del lado que
    // queda hacia la cámara). ejes.z.x > 0 = la cara mira hacia la derecha de la imagen.
    const giro = Math.asin(Math.max(-1, Math.min(1, o.ejes.z.x))) * 180 / Math.PI;
    const aparecer = (g) => Math.min(1, Math.max(0, (g - 9) / 12));
    lados[-1].forEach((mt) => (mt.opacity = aparecer(giro)));
    lados[1].forEach((mt) => (mt.opacity = aparecer(-giro)));
    [cabeza, orejaI, orejaD].forEach((x) => x.updateMatrix());

    const v = (a) => new THREE.Vector3(a.x, a.y, a.z);
    raiz.matrix.makeBasis(v(o.ejes.x), v(o.ejes.y), v(o.ejes.z)).scale(new THREE.Vector3(o.esc, o.esc, o.esc));
    raiz.matrix.setPosition(o.pos.x, -o.pos.y, 0);
    raiz.matrixWorldNeedsUpdate = true;
    renderer.render(escena, camara);
  }

  return { dibujar, canvas: renderer.domElement };
}
