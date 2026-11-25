// Probador virtual de gafas: detecta la cara (MediaPipe Face Landmarker),
// mide la escala real con el iris y pone la montura a su ancho real en mm.
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

// El modelo y su motor van dentro de la app (vendor/), así funciona también
// publicada, donde la página no puede descargar archivos de otros sitios.
const WASM = new URL("./vendor/wasm", import.meta.url).href;
// el modelo va como texto base64 dentro de un .js (el servidor no sirve archivos .task)
const modeloBytes = () => import("./vendor/modelo_cara.js")
  .then((m) => Uint8Array.from(atob(m.default), (c) => c.charCodeAt(0)));
const HEIC_LIB = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js";

const IRIS_MM = 11.7;      // diámetro medio del iris humano
const DIP_MM = 63;         // distancia interpupilar media de un adulto
const ANCLA_Y = 0.46;      // altura de la pupila dentro de la imagen de la montura (0 = arriba)
const MAX_LADO = 1600;     // reducir fotos grandes antes de analizarlas
// Las gafas quedan ~12 mm por delante del ojo, o sea un poco más cerca de la
// cámara que el iris con el que medimos: a distancia de selfie se ven ~3% más grandes.
const PLANO_GAFAS = 1.03;

const $ = (id) => document.getElementById(id);
const lienzo = $("lienzo"), ctx = lienzo.getContext("2d");
const lienzo3d = $("lienzo3d");
let visor = null;   // visor 3D (si el navegador tiene WebGL)
const video = $("video");
// Sin gafas de sol, ni monturas con lente oscuro que la tienda no marca como de sol
const QUITAR = ["AC12437", "FM2664"];
const catalogo = (window.CATALOGO || []).filter((g) => !g.sol && !QUITAR.includes(g.nombre));

const estado = {
  sel: 0,
  fuente: null,          // canvas (foto) o video
  modo: null,            // "foto" | "camara"
  cara: null,            // parámetros calculados de la cara
  suave: null,           // parámetros suavizados (cámara)
  sinGafas: false,
  ajY: 0,
  dp: +localStorage.getItem("dp") || 0,   // distancia pupilar de la persona, si la sabe
  lm: null,               // puntos de la cara de la foto (para recalcular)
  dipCam: [],             // DP medida en cada cuadro de la cámara
  imgs: {},
};

/* ---------- Catálogo ---------- */
const cop = (n) => "COP$" + n.toLocaleString("es-CO");
// Filtros: Mujer y Hombre incluyen las unisex; De sol muestra solo las de sol
const FILTROS = {
  todas: () => true,
  mujer: (g) => !g.sol && g.genero !== "hombre",
  hombre: (g) => !g.sol && g.genero !== "mujer",
  sol: (g) => g.sol,
};
let visibles = catalogo.map((_, i) => i);
function filtrar(f) {
  visibles = catalogo.map((g, i) => (FILTROS[f](g) ? i : -1)).filter((i) => i >= 0);
  document.querySelectorAll(".filtro").forEach((b) => b.setAttribute("aria-pressed", b.dataset.f === f));
  pintarTarjetas();
  elegir(visibles.includes(estado.sel) ? estado.sel : visibles[0]);
}
function pintarTarjetas() {
  const tira = $("tira");
  tira.innerHTML = "";
  tira.scrollTo(0, 0);
  visibles.forEach((i) => {
    const g = catalogo[i];
    const b = document.createElement("button");
    b.className = "tarjeta";
    b.dataset.i = i;
    b.setAttribute("aria-pressed", i === estado.sel);
    b.title = "Arrastra o pasa el mouse para girarla 360°";
    b.innerHTML = `<span class="g360" aria-hidden="true">360°</span>
      <div class="vista"><img src="${g.img}" alt="" loading="lazy"><canvas></canvas></div>
      <b>${g.nombre}</b><span>${cop(g.precio)}</span>`;
    b.onclick = () => { if (!giro.arrastro) elegir(i); };
    prepararGiro(b, g);
    tira.appendChild(b);
  });
}

/* ---------- Giro 360° de cada montura en su tarjeta ---------- */
// Un solo visor 3D (fuera de pantalla) dibuja la tarjeta que se está girando
// y se copia a su lienzo: así no hacen falta 41 contextos WebGL.
const giro = { visor: null, lienzo: null, tarjeta: null, g: null, ang: 0, auto: false, arrastre: null, arrastro: false, t: 0, raf: 0 };
function ejesGiro(th) {
  const fi = 0;    // a la altura de los ojos: de frente coincide con la foto fija
  const s = Math.sin(th), c = Math.cos(th), sf = Math.sin(fi), cf = Math.cos(fi);
  return { x: { x: c, y: 0, z: -s }, y: { x: s * sf, y: cf, z: c * sf }, z: { x: s * cf, y: -sf, z: c * cf } };
}
function pintarGiro() {
  const { tarjeta, g, visor } = giro;
  if (!tarjeta || !visor) return;
  const im = estado.imgs[g.id];
  if (!im || !im.complete || !im.naturalWidth) return;
  g._img = im;
  const cv = tarjeta.querySelector("canvas");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
  if (!W || !H) return;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const largo = g.largoPataMm || 145;
  // misma escala y posición que la foto fija de la tarjeta (80% del ancho, centrada),
  // así al empezar a girar no hay salto; de lado, las patas caben en la tarjeta
  const esc = W * 0.8 / g.anchoMm;
  const altoMm = g.anchoMm * im.naturalHeight / im.naturalWidth;
  const ejes = ejesGiro(giro.ang);
  // girar alrededor del centro de la gafa (a mitad de las patas), no de las pupilas
  const zc = -(largo / 2 - 12);
  const cx = W / 2, cy = H / 2 - (0.5 - 0.46) * altoMm * esc;   // 0.46 = altura de la pupila en la foto
  visor.dibujar({
    W, H, gafa: g, producto: true, ejes, esc,
    pos: { x: cx - zc * esc * ejes.z.x, y: cy + zc * esc * ejes.z.y },
    centro: { x: cx, y: cy }, focal: W * 6, ajYmm: 0, caraMm: 0,
  });
  const c2 = cv.getContext("2d");
  c2.clearRect(0, 0, W, H);
  c2.drawImage(giro.lienzo, 0, 0);
}
function bucleGiro(t) {
  const dt = giro.t ? Math.min(50, t - giro.t) : 16;
  giro.t = t;
  if (giro.auto && !giro.arrastre) giro.ang += dt * 0.0016;   // ~1 vuelta cada 4 s
  pintarGiro();
  giro.raf = giro.tarjeta ? requestAnimationFrame(bucleGiro) : 0;
}
function empezarGiro(b, g, auto) {
  if (!giro.visor) return;
  if (giro.tarjeta && giro.tarjeta !== b) giro.tarjeta.classList.remove("girando");
  if (giro.tarjeta !== b) giro.ang = 0;
  giro.tarjeta = b; giro.g = g; giro.auto = auto;
  b.classList.add("girando");
  if (!giro.raf) { giro.t = 0; giro.raf = requestAnimationFrame(bucleGiro); }
}
function pararGiro(b) {
  if (giro.tarjeta !== b || giro.arrastre) return;
  b.classList.remove("girando");
  giro.tarjeta = null;
}
function prepararGiro(b, g) {
  b.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") empezarGiro(b, g, true); });
  b.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") pararGiro(b); });
  b.addEventListener("pointerdown", (e) => {
    giro.arrastro = false;
    giro.arrastre = { x: e.clientX, ang: giro.tarjeta === b ? giro.ang : 0, id: e.pointerId };
    empezarGiro(b, g, false);
  });
  b.addEventListener("pointermove", (e) => {
    const a = giro.arrastre;
    if (!a || a.id !== e.pointerId || giro.tarjeta !== b) return;
    const dx = e.clientX - a.x;
    if (Math.abs(dx) > 6 && !giro.arrastro) { giro.arrastro = true; b.setPointerCapture(e.pointerId); }
    if (giro.arrastro) giro.ang = a.ang + dx * 0.022;
  });
  const soltar = (e) => {
    if (!giro.arrastre || giro.arrastre.id !== e.pointerId) return;
    giro.arrastre = null;
    if (e.pointerType === "mouse") giro.auto = !giro.arrastro && b.matches(":hover");
    else if (!giro.arrastro) giro.auto = true;          // en el celular: un toque la hace girar
    setTimeout(() => (giro.arrastro = false), 0);
  };
  b.addEventListener("pointerup", soltar);
  b.addEventListener("pointercancel", (e) => { soltar(e); pararGiro(b); });
}
function mover(paso) {
  const k = visibles.indexOf(estado.sel);
  elegir(visibles[(k + paso + visibles.length) % visibles.length]);
}
function elegir(i) {
  estado.sel = i;
  document.querySelectorAll(".tarjeta").forEach((b) => {
    const on = +b.dataset.i === estado.sel;
    b.setAttribute("aria-pressed", on);
    if (on) b.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  });
  const g = catalogo[estado.sel];
  $("bImg").src = g.img;
  $("bNombre").textContent = g.nombre;
  $("bTipo").textContent = `${g.tipo} · ${g.talla}`;
  $("bAncho").textContent = `${g.anchoMm} mm`;
  $("bPrecio").textContent = cop(g.precio);
  $("bAntes").textContent = g.antes ? cop(g.antes) : "";
  $("bLink").href = g.url;
  actualizarEncaje();
  dibujar();
}
function cargarImgs() {
  catalogo.forEach((g) => { const im = new Image(); im.src = g.img; im.onload = dibujar; estado.imgs[g.id] = im; });
}

/* ---------- Detector ---------- */
let detectorP = null, modoDetector = null;
function detector() {
  if (!detectorP) {
    detectorP = (async () => {
      const [files, modelo] = await Promise.all([FilesetResolver.forVisionTasks(WASM), modeloBytes()]);
      const crear = (delegate) => FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetBuffer: modelo, delegate },
        runningMode: "IMAGE", numFaces: 1,
      });
      let d;
      try { d = await crear("GPU"); } catch { d = await crear("CPU"); }
      modoDetector = "IMAGE";
      return d;
    })();
    detectorP.catch(() => { detectorP = null; });
  }
  return detectorP;
}
async function usarModo(d, modo) {
  if (modoDetector !== modo) { await d.setOptions({ runningMode: modo }); modoDetector = modo; }
}

/* ---------- Geometría de la cara ---------- */
function medirCara(lm, W, H) {
  const P = (i) => ({ x: lm[i].x * W, y: lm[i].y * H, z: lm[i].z * W });
  const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const pD = P(468), pI = P(473);                 // centro de cada iris
  const dip2 = d2(pD, pI), dip3 = d3(pD, pI);
  const giro = Math.min(1, Math.max(0.55, dip2 / dip3));
  // Diámetro del iris: promedio de los dos ojos, en horizontal (corregido por el
  // giro de la cabeza) y en vertical. Es la regla de medir: casi todos los
  // adultos tienen el iris de ~11,7 mm, sin importar el tamaño de la cara.
  const iris = (d2(P(469), P(471)) / giro + d2(P(470), P(472)) + d2(P(474), P(476)) / giro + d2(P(475), P(477))) / 4;
  let pxmm, fuente;
  if (estado.dp) { pxmm = dip3 / estado.dp; fuente = "dp"; }     // la medida exacta de la persona
  else {
    pxmm = iris / IRIS_MM; fuente = "iris";
    // si el iris salió muy raro (foto borrosa, ojos entrecerrados), usar la DP promedio
    const r = pxmm / (dip3 / DIP_MM);
    if (!(r > 0.72 && r < 1.38)) { pxmm = dip3 / DIP_MM; fuente = "promedio"; }
  }
  const xs = lm.map((p) => p.x * W), ys = lm.map((p) => p.y * H);
  // Orientación de la cabeza en 3D (x: hacia la derecha de la imagen,
  // y: hacia arriba, z: hacia la cámara), sacada de los ojos y de frente-mentón
  const T = (i) => { const q = P(i); return { x: q.x, y: -q.y, z: -q.z }; };
  const resta = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const ejes = ortonormal(resta(T(263), T(33)), resta(T(10), T(152)));
  return {
    cx: (pD.x + pI.x) / 2, cy: (pD.y + pI.y) / 2, cz: (pD.z + pI.z) / 2, ejes,
    ang: Math.atan2(pI.y - pD.y, pI.x - pD.x),
    pxmm, fuente,
    dipMm: dip3 / pxmm, dip3,
    giro,   // achatar la montura si la cabeza gira
    anchoCaraMm: d3(P(127), P(356)) / pxmm,
    caja: { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) },
  };
}
function ortonormal(vx, vy) {
  const n = (v) => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
  const x = n(vx);
  const d = vy.x * x.x + vy.y * x.y + vy.z * x.z;
  const y = n({ x: vy.x - x.x * d, y: vy.y - x.y * d, z: vy.z - x.z * d });
  const z = { x: x.y * y.z - x.z * y.y, y: x.z * y.x - x.x * y.z, z: x.x * y.y - x.y * y.x };
  return { x, y, z };
}
function mezclar(a, b, k) {
  if (!a) return structuredClone(b);
  const m = (u, v) => u + (v - u) * k;
  const mv = (u, v) => ({ x: m(u.x, v.x), y: m(u.y, v.y), z: m(u.z, v.z) });
  return {
    cz: m(a.cz, b.cz), ejes: ortonormal(mv(a.ejes.x, b.ejes.x), mv(a.ejes.y, b.ejes.y)),
    cx: m(a.cx, b.cx), cy: m(a.cy, b.cy), ang: m(a.ang, b.ang), pxmm: m(a.pxmm, b.pxmm), giro: m(a.giro, b.giro),
    anchoCaraMm: m(a.anchoCaraMm, b.anchoCaraMm), dipMm: m(a.dipMm, b.dipMm), fuente: b.fuente,
    caja: { x0: m(a.caja.x0, b.caja.x0), x1: m(a.caja.x1, b.caja.x1), y0: m(a.caja.y0, b.caja.y0), y1: m(a.caja.y1, b.caja.y1) },
  };
}

/* ---------- Dibujo ---------- */
function ajustarLienzo() {
  const r = lienzo.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (lienzo.width !== w || lienzo.height !== h) { lienzo.width = w; lienzo.height = h; }
}
function dibujar() {
  ajustarLienzo();
  const W = lienzo.width, H = lienzo.height;
  ctx.clearRect(0, 0, W, H);
  const f = estado.fuente, c = estado.modo === "camara" ? estado.suave : estado.cara;
  if (!f || !c) return;
  const sw = f.videoWidth || f.width, sh = f.videoHeight || f.height;

  // Encuadre de cerca: la cara ocupa ~50% de la altura del espejo
  const altoCara = c.caja.y1 - c.caja.y0;
  let ch = altoCara / 0.5, cw = ch * (W / H);
  const ccx = (c.caja.x0 + c.caja.x1) / 2, ccy = c.cy + altoCara * 0.02;
  let sx = ccx - cw / 2, sy = ccy - ch / 2;
  // si el recorte se sale de la foto, ampliarlo para no mostrar bordes vacíos
  const esc = Math.max(1, cw / sw, ch / sh);
  if (esc > 1) { cw /= esc; ch /= esc; sx = ccx - cw / 2; sy = ccy - ch / 2; }
  sx = Math.min(Math.max(sx, 0), Math.max(0, sw - cw));
  sy = Math.min(Math.max(sy, 0), Math.max(0, sh - ch));
  const k = W / cw;

  ctx.save();
  if (estado.modo === "camara") { ctx.translate(W, 0); ctx.scale(-1, 1); }  // efecto espejo
  ctx.drawImage(f, sx, sy, cw, ch, 0, 0, W, H);

  const g = catalogo[estado.sel], im = g && estado.imgs[g.id];
  if (visor) {
    // Gafas en 3D (siguen el giro de la cabeza; se ven las patas)
    lienzo3d.style.transform = estado.modo === "camara" ? "scaleX(-1)" : "";
    if (g) g._img = im;
    visor.dibujar({
      W, H,
      gafa: !estado.sinGafas && im && im.complete && im.naturalWidth ? g : null,
      pos: { x: (c.cx - sx) * k, y: (c.cy - sy) * k },
      ejes: c.ejes,
      esc: c.pxmm * k,   // la perspectiva ya agranda lo que está más cerca (el frente)
      // cámara típica de celular/computador: distancia focal ≈ 0,75 × el lado largo de la imagen
      centro: { x: (sw / 2 - sx) * k, y: (sh / 2 - sy) * k },
      focal: 0.75 * Math.max(sw, sh) * k,
      ajYmm: -estado.ajY * 0.5,
      caraMm: c.anchoCaraMm,
    });
  } else if (!estado.sinGafas && im && im.complete && im.naturalWidth) {
    const pxmm = c.pxmm * k;
    const gw = g.anchoMm * pxmm * PLANO_GAFAS;   // ancho real de la montura
    const gh = gw * im.naturalHeight / im.naturalWidth;
    ctx.translate((c.cx - sx) * k, (c.cy - sy) * k);
    ctx.rotate(c.ang);
    ctx.scale(c.giro, 1);
    ctx.shadowColor = "rgba(30,20,10,.30)";
    ctx.shadowBlur = gw * 0.012;
    ctx.shadowOffsetY = gw * 0.012;
    ctx.drawImage(im, -gw / 2, -gh * ANCLA_Y + estado.ajY * 0.5 * pxmm, gw, gh);
  }
  ctx.restore();
}

/* ---------- Ajuste de talla ---------- */
function actualizarEncaje() {
  const c = estado.modo === "camara" ? estado.suave : estado.cara;
  const box = $("bEncajeBox"), el = $("bEncaje");
  if (!c) { box.hidden = true; return; }
  const dif = catalogo[estado.sel].anchoMm - c.anchoCaraMm;
  box.hidden = false;
  if (dif > 8) { el.textContent = "Algo ancha"; el.className = "ancha"; }
  else if (dif < -10) { el.textContent = "Algo angosta"; el.className = "angosta"; }
  else { el.textContent = "Buen tamaño"; el.className = "ok"; }
  box.title = `Tu cara mide aprox. ${Math.round(c.anchoCaraMm)} mm a la altura de las sienes; esta montura ${catalogo[estado.sel].anchoMm} mm.`;
}

/* ---------- Cómo se midió el tamaño ---------- */
function mediana(a) { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; }
function pintarEscala() {
  const c = estado.modo === "camara" ? estado.suave : estado.cara, el = $("escala");
  if (!c) { el.hidden = true; return; }
  el.hidden = false;
  const fuente = estado.dp ? "dp" : c.fuente;
  el.className = "escala " + (fuente === "dp" ? "exacta" : "aprox");
  el.textContent = fuente === "dp"
    ? `📏 Tamaño real · calibrado con tu DP de ${estado.dp} mm`
    : fuente === "iris"
      ? `📏 Tamaño real aprox. (±5%) · tu DP estimada: ${Math.round(c.dipMm)} mm · ¿Sabes tu DP?`
      : `📏 Tamaño aproximado · escribe tu DP para que sea exacto`;
}

/* ---------- Estados de la interfaz ---------- */
function mostrarEstado(txt, error = false) {
  const e = $("estado");
  e.hidden = !txt; e.classList.toggle("error", error); $("estadoTxt").textContent = txt || "";
}
function modoProbando(on) {
  $("vacio").hidden = on; $("herramientas").hidden = !on;
  if (!on) $("ajustes").hidden = true;
}

/* ---------- Foto ---------- */
async function aImagen(file) {
  const esHeic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
  const abrir = (blob) => new Promise((ok, mal) => {
    const url = URL.createObjectURL(blob), im = new Image();
    im.onload = () => ok(im); im.onerror = mal; im.src = url;
  });
  try { return await abrir(file); }
  catch (e) {
    if (!esHeic) throw e;
    // Fotos de iPhone (HEIC): la mayoría de navegadores no las leen, se convierten a JPG
    mostrarEstado("Convirtiendo foto de iPhone…");
    if (!window.heic2any) await new Promise((ok, mal) => {
      const s = document.createElement("script"); s.src = HEIC_LIB; s.onload = ok; s.onerror = mal; document.head.appendChild(s);
    });
    const jpg = await window.heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    return abrir(Array.isArray(jpg) ? jpg[0] : jpg);
  }
}
async function usarFoto(file) {
  if (!file) return;
  pararCamara();
  mostrarEstado("Buscando tu cara…");
  try {
    const [im, d] = await Promise.all([aImagen(file), detector()]);
    const s = Math.min(1, MAX_LADO / Math.max(im.naturalWidth, im.naturalHeight));
    const cv = document.createElement("canvas");
    cv.width = Math.round(im.naturalWidth * s); cv.height = Math.round(im.naturalHeight * s);
    cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
    await usarModo(d, "IMAGE");
    const res = d.detect(cv);
    if (!res.faceLandmarks?.length) {
      mostrarEstado("No encontramos una cara. Prueba con una foto de frente, con buena luz y sin nada tapando los ojos.", true);
      return;
    }
    estado.fuente = cv; estado.modo = "foto";
    estado.lm = res.faceLandmarks[0];
    estado.cara = medirCara(estado.lm, cv.width, cv.height);
    modoProbando(true); mostrarEstado("");
    pintarEscala();
    actualizarEncaje(); dibujar();
  } catch (e) {
    console.error(e);
    mostrarEstado("No pudimos abrir esa foto. Prueba con otra (JPG o PNG).", true);
  }
}

/* ---------- Cámara ---------- */
let corriendo = false, ultimoT = -1;
async function usarCamara() {
  if (!navigator.mediaDevices?.getUserMedia) { mostrarEstado("Este navegador no permite usar la cámara. Sube una foto.", true); return; }
  mostrarEstado("Abriendo la cámara…");
  try {
    const [stream, d] = await Promise.all([
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false }),
      detector(),
    ]);
    video.srcObject = stream; await video.play();
    await usarModo(d, "VIDEO");
    estado.fuente = video; estado.modo = "camara"; estado.suave = null; estado.dipCam = [];
    corriendo = true; modoProbando(true);
    mostrarEstado("Mira de frente a la cámara…");
    const bucle = () => {
      if (!corriendo) return;
      const t = performance.now();
      if (video.readyState >= 2 && t !== ultimoT) {
        ultimoT = t;
        const res = d.detectForVideo(video, t);
        if (res.faceLandmarks?.length) {
          const c = medirCara(res.faceLandmarks[0], video.videoWidth, video.videoHeight);
          // La escala en mm cambia cuando te acercas o alejas, pero tu DP no:
          // se toma la mediana de muchos cuadros y con ella se fija la escala.
          if (c.fuente === "iris") {
            estado.dipCam.push(c.dipMm);
            if (estado.dipCam.length > 90) estado.dipCam.shift();
            const dip = mediana(estado.dipCam);
            const nuevo = c.dip3 / dip;
            c.anchoCaraMm = c.anchoCaraMm * c.pxmm / nuevo;
            c.pxmm = nuevo; c.dipMm = dip;
          }
          const primera = !estado.suave;
          estado.suave = mezclar(estado.suave, c, 0.45);
          if (primera) { mostrarEstado(""); actualizarEncaje(); }
          if (primera || estado.dipCam.length % 15 === 0) pintarEscala();
        }
        dibujar();
      }
      requestAnimationFrame(bucle);
    };
    bucle();
    clearInterval(usarCamara.t);
    usarCamara.t = setInterval(() => corriendo && actualizarEncaje(), 800);
  } catch (e) {
    console.error(e);
    const negado = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
    mostrarEstado(negado ? "No diste permiso para la cámara. Puedes subir una foto." : "No pudimos abrir la cámara. Puedes subir una foto.", true);
    if (!estado.fuente) modoProbando(false);
  }
}
function pararCamara() {
  corriendo = false;
  const s = video.srcObject; if (s) s.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}

/* ---------- Eventos ---------- */
$("archivo").onchange = (e) => { usarFoto(e.target.files[0]); e.target.value = ""; };
$("btnCamara").onclick = usarCamara;
$("btnCamara2").onclick = usarCamara;
$("btnOtra").onclick = () => $("archivo").click();
$("btnAjustar").onclick = () => {
  const a = $("ajustes"); a.hidden = !a.hidden; $("btnAjustar").setAttribute("aria-expanded", !a.hidden);
};
$("ajY").oninput = (e) => { estado.ajY = +e.target.value; dibujar(); };
$("ajReset").onclick = () => { estado.ajY = 0; $("ajY").value = 0; dibujar(); };
$("dp").value = estado.dp || "";
$("dp").oninput = (e) => {
  const v = parseFloat(String(e.target.value).replace(",", "."));
  estado.dp = v >= 45 && v <= 80 ? v : 0;      // rango real de DP en adultos
  if (estado.dp) localStorage.setItem("dp", estado.dp); else localStorage.removeItem("dp");
  if (estado.modo === "foto" && estado.lm) estado.cara = medirCara(estado.lm, estado.fuente.width, estado.fuente.height);
  estado.dipCam = []; estado.suave = null;
  pintarEscala(); actualizarEncaje(); dibujar();
};
$("escala").onclick = () => { $("ajustes").hidden = false; $("btnAjustar").setAttribute("aria-expanded", true); $("dp").focus(); };
$("btnComparar").onclick = () => {
  estado.sinGafas = !estado.sinGafas;
  $("btnComparar").textContent = estado.sinGafas ? "◑ Con gafas" : "◐ Sin gafas";
  dibujar();
};
$("btnBajar").onclick = () => {
  // juntar la foto y las gafas 3D (con su sombra) en una sola imagen
  const out = document.createElement("canvas");
  out.width = lienzo.width; out.height = lienzo.height;
  const o = out.getContext("2d");
  o.drawImage(lienzo, 0, 0);
  if (visor) {
    o.save();
    if (estado.modo === "camara") { o.translate(out.width, 0); o.scale(-1, 1); }
    o.filter = `drop-shadow(0 ${out.width * 0.006}px ${out.width * 0.006}px rgba(30,20,10,.35))`;
    o.drawImage(lienzo3d, 0, 0);
    o.restore();
  }
  const nombre = `probador-${catalogo[estado.sel].nombre}.jpg`;
  out.toBlob(async (b) => {
    if (descargas) {
      // publicada en Claude: la descarga la ofrece la plataforma
      try { await descargas.save({ filename: nombre, data: b }); }
      catch (e) { if (e?.code !== "declined") mostrarEstado("No se pudo guardar la foto aquí.", true); }
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = nombre; a.click();
  }, "image/jpeg", 0.92);
};
// Publicada en Claude no se permite la cámara en vivo: el botón Cámara abre la
// cámara del celular para tomarse una foto (en computador abre el selector de archivos).
// Las descargas van por la plataforma.
let descargas = null;
const enClaude = !!window.claude?.use;
let enMarco = false; try { enMarco = window.self !== window.top; } catch { enMarco = true; }
const sinVivo = enClaude || enMarco || (document.featurePolicy && !document.featurePolicy.allowsFeature("camera"));
if (sinVivo) {
  const tomar = () => $("archivoCam").click();
  $("btnCamara").onclick = tomar; $("btnCamara2").onclick = tomar;
  $("btnCamara").textContent = "Tomarme una foto";
  $("archivoCam").onchange = (e) => { usarFoto(e.target.files[0]); e.target.value = ""; };
}
if (enClaude) {
  $("btnBajar").hidden = true;
  window.claude.use("downloads").then((d) => { descargas = d; if (d) $("btnBajar").hidden = false; }).catch(() => {});
}
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  if (e.key === "ArrowRight") mover(1);
  if (e.key === "ArrowLeft") mover(-1);
});
// arrastrar una foto al espejo
$("espejo").addEventListener("dragover", (e) => e.preventDefault());
$("espejo").addEventListener("drop", (e) => { e.preventDefault(); usarFoto(e.dataTransfer.files[0]); });
new ResizeObserver(dibujar).observe(lienzo);

document.querySelectorAll(".filtro").forEach((b) => (b.onclick = () => filtrar(b.dataset.f)));
pintarTarjetas(); cargarImgs(); elegir(0);
import("./gafas3d.js")
  .then((m) => {
    visor = m.crearVisor3D(lienzo3d, () => requestAnimationFrame(dibujar)); dibujar();
    try { giro.lienzo = document.createElement("canvas"); giro.visor = m.crearVisor3D(giro.lienzo, pintarGiro); }
    catch (e) { console.warn("Sin giro 360°:", e); }
  })
  .catch((e) => { console.warn("Sin 3D, se usa la vista plana:", e); lienzo3d.hidden = true; });
detector().catch(() => {});   // ir cargando el modelo mientras la persona elige foto
