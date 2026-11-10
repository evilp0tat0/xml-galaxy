/* Drawing, camera and interaction. */
(function(){
"use strict";
const XO = window.XO, clip = XO.clip;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const SAMPLE = "samples/S-201_FC_OpenS100_draft.xml";

const canvas = $("sky"), ctx = canvas.getContext("2d");
/* examples that open with a bundled dictionary: the dataset is explained by the catalogue */
const SAMPLE_DICTS = { "samples/S-201_dataset_example.xml":SAMPLE };
/* the two views of the same elements, and the one chosen last in this browser */
const VIEWS = { orbit:"Orbit view", tree:"Tree view" }, VIEW_KEY = "xml-viewer.view";
let savedView = null;
try { savedView = localStorage.getItem(VIEW_KEY); } catch {}
const A = { doc:null, src:null, O:null, view:savedView === "tree" ? "tree" : "orbit", playing:!REDUCED, dicts:[],
  cam:{ x:0, y:0, k:1 }, camTo:null, follow:null, followK:null, hover:null, sel:null, ptr:null, pinch:null, userLoaded:false };

/* ---------------- colours ---------------- */
const colour = key => A.src?.palette.get(key)?.color || "#6b7280";
const CYAN = "#06b6d4";
const glowCache = new Map();
function glowSprite(col){
  if (glowCache.has(col)) return glowCache.get(col);
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, col + "cc"); gr.addColorStop(0.35, col + "44"); gr.addColorStop(1, col + "00");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  glowCache.set(col, c); return c;
}
/* ---------------- canvas size ---------------- */
let W = 0, H = 0, DPR = 1;
function resize(){
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = canvas.clientWidth; H = canvas.clientHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  kick();
}
/* the free part of the screen: below the top bar, left of the side panel */
function freeArea(){
  const top = Math.max(...["top", "rootLine"].map(id => $(id)).filter(el => !el.hidden).map(el => el.getBoundingClientRect().bottom)) + 8;
  const side = $("side"), sr = side.hidden ? null : side.getBoundingClientRect();
  const right = sr && W > 760 ? sr.left - 56 : W - 56;
  const bottom = sr && W <= 760 ? sr.top - 8 : $("foot").getBoundingClientRect().top - 8;
  const lc = $("leftcol"), left = ($("legend").open || $("namesBox").open) && W > 760 ? Math.min(lc.getBoundingClientRect().right + 8, W * 0.4) : 8;
  return { x0:left, y0:top, x1:right, y1:Math.max(top + 80, bottom) };
}

/* ---------------- frame loop ---------------- */
/* The physics runs every frame, but the canvas is drawn again only when the picture would change: after kick() (every change
   of state calls it), while a search pulse runs or folded-away bodies fade, or once something drawn has moved a quarter of a
   canvas pixel: a body, or the orbit it rides on as orbits grow and shrink after a rebuild. Text is placed to a quarter pixel
   anyway, so smaller steps hardly show; zoomed out on a big file the bodies creep a few hundredths of a pixel a frame, and
   most frames are skipped. When everything comes to rest, the exact picture is drawn. */
let raf = 0, last = 0, dirty = true;
function kick(){ dirty = true; if (!raf) raf = requestAnimationFrame(frame); }
function frame(now){
  raf = 0;
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now;
  const spin = A.playing && A.O?.mode === "orbit" && !A.hover && !A.ptr?.dragging;   /* nothing turns before a file is loaded, or in the tree */
  const moving = A.O ? A.O.step(dt, spin) : false;
  const camMoving = cameraStep();
  /* a pulse whose body has folded away shows nothing, and need not keep the loop running */
  const pulsing = !!A.pulse && !!A.O?.bodies.has(A.pulse.id);
  const busy = spin || moving || camMoving || A.ptr?.dragging || pulsing;
  const d = dirty ? Infinity : moved();
  const drew = pulsing || d > 0.25 / DPR || (!busy && d > 0);
  if (drew) { dirty = false; draw(); remember(); }
  /* hover still notices a body drifting under a still mouse every frame; the tip moves with the picture */
  if (!A.ptr && A.mx != null && (camMoving || moving || spin)) { const h = hit(A.mx, A.my, A.mslop); if ((h?.id ?? null) !== A.hover) setHover(h); else if (drew && h && !$("tip").hidden) placeTip(h); }
  /* setHover above may already have asked for the next frame: asking again would run two loops */
  if (busy) { if (!raf) raf = requestAnimationFrame(frame); } else last = 0;
}
/* what the canvas showed when it was last drawn: each body's place on screen and the radius of the orbit it rides on */
const seen = { pos:new Float64Array(0) };
function remember(){
  const O = A.O, c = A.cam, s = seen;
  Object.assign(s, { O, order:O?.order, ghosts:O ? O.ghosts.length : 0, k:c.k, W, H, DPR, hover:A.hover, sel:A.sel });
  if (!O) return;
  const n = O.order.length; if (s.pos.length < 3 * n) s.pos = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) { const b = O.order[i]; s.pos[3 * i] = c.x + c.k * b.x; s.pos[3 * i + 1] = c.y + c.k * b.y; s.pos[3 * i + 2] = b.ring ? b.ring.rd * c.k : 0; }
}
/* How far anything drawn has moved on screen since then; Infinity when something else changed (a rebuild, the zoom, bodies
   fading away, hover or selection, the canvas). Bodies off screen count too: their orbits and links can cross it. */
function moved(){
  const O = A.O, c = A.cam, s = seen;
  if (O !== s.O || O?.order !== s.order || c.k !== s.k || W !== s.W || H !== s.H || DPR !== s.DPR || A.hover !== s.hover || A.sel !== s.sel || s.ghosts || O?.ghosts.length) return Infinity;
  if (!O) return 0;
  let m = 0;
  for (let i = 0, n = O.order.length; i < n; i++) {
    const b = O.order[i], p = 3 * i;
    m = Math.max(m, Math.abs(c.x + c.k * b.x - s.pos[p]), Math.abs(c.y + c.k * b.y - s.pos[p + 1]), Math.abs((b.ring ? b.ring.rd * c.k : 0) - s.pos[p + 2]));
  }
  return m;
}
function cameraStep(){
  const c = A.cam, f = REDUCED ? 1 : 0.13;
  if (A.follow && !(A.ptr?.dragging && A.ptr.body?.id === A.follow)) {
    const b = A.O?.bodies.get(A.follow);
    if (!b) { A.follow = null; return false; }
    const fa = freeArea(), cx = (fa.x0 + fa.x1) / 2, cy = (fa.y0 + fa.y1) / 2;
    const k = A.followK ? c.k + (A.followK - c.k) * f : c.k;
    if (A.followK && Math.abs(A.followK - c.k) < 0.002) A.followK = null;
    /* lock onto the body and ease only its offset from the centre, so however fast it orbits the camera never lags */
    if (!A.followOff) A.followOff = [c.x + c.k * b.x - cx, c.y + c.k * b.y - cy];
    const o = A.followOff; o[0] *= 1 - f; o[1] *= 1 - f;
    c.x = cx + o[0] - k * b.x; c.y = cy + o[1] - k * b.y; c.k = k;
    return Math.abs(o[0]) > 0.3 || Math.abs(o[1]) > 0.3 || !!A.followK;
  }
  if (A.camTo) {
    const t = A.camTo;
    c.x += (t.x - c.x) * f; c.y += (t.y - c.y) * f; c.k += (t.k - c.k) * f;
    if (Math.abs(t.x - c.x) + Math.abs(t.y - c.y) < 0.5 && Math.abs(t.k - c.k) < 0.001) { Object.assign(c, t); A.camTo = null; }
    return true;
  }
  return false;
}
/* how far in the camera can zoom: to the deepest moons */
const MAX_ZOOM = 1e5;
/* the zoom at which the whole map fits the free part of the screen */
function fitZoom(fa){
  const B = A.O.bounds(), k = Math.min(1.6, (fa.x1 - fa.x0) / (B.x1 - B.x0 + 240), (fa.y1 - fa.y0) / (B.y1 - B.y0 + 240));
  return isFinite(k) && k > 0 ? k : 0.05;
}
/* how far out it can zoom: to 0.01%, or further when a big file shown in full needs it to fit */
const minZoom = () => Math.min(1e-4, fitZoom(freeArea()));
function fit(animate = true){
  if (!A.O) return;
  A.follow = null; A.followK = null;
  const fa = freeArea(), k = fitZoom(fa), B = A.O.bounds();
  const t = { x:(fa.x0 + fa.x1) / 2 - k * (B.x0 + B.x1) / 2, y:(fa.y0 + fa.y1) / 2 - k * (B.y0 + B.y1) / 2, k };
  if (animate && !REDUCED) A.camTo = t; else { Object.assign(A.cam, t); A.camTo = null; }
  kick();
}
function followBody(b, zoomToSystem){
  if (!b) return;
  A.camTo = null;
  if (!b.parent) { fit(true); return; }
  A.follow = b.id; A.followOff = null;
  if (zoomToSystem) {
    const fa = freeArea();
    /* a body with no orbits of its own: show it with its neighbourhood, not filling the screen */
    const R = b.sysR ? (b.sysR + b.size) * 1.15 + b.size * 0.5 : b.size * 12;
    A.followK = Math.max(0.05, Math.min(MAX_ZOOM, Math.min(fa.x1 - fa.x0, fa.y1 - fa.y0) / (2 * R)));
  }
  kick();
}

/* ---------------- what is lit ---------------- */
/* draw() and placeTip() ask for this every frame; it is worked out again only when the hovered or selected body,
   or the map (a rebuild makes a new order), changes */
let litMemo = null;
function litSet(){
  const O = A.O; if (!O) return null;
  const d = O.bodies.get(A.hover) || O.bodies.get(A.sel);
  if (!d) return null;
  if (litMemo && litMemo.order === O.order && litMemo.d === d) return litMemo.lit;
  const lit = litOf(O, d);
  litMemo = { order:O.order, d, lit };
  return lit;
}
function litOf(O, d){
  const nodes = new Set(), links = new Set(), rings = new Set(), chain = O.chainOf(d), onChain = new Set(chain.map(x => x.id));
  for (const x of chain) nodes.add(x.id);
  for (let i = 0; i < chain.length - 1; i++) { const r = chain[i + 1].ring; if (r) rings.add(r.id); }
  for (const r of d.rings) rings.add(r.id);
  for (const l of O.links) {
    const a = l.a.id, b = l.b.id;
    if ((l.kind === "spoke" && onChain.has(a) && onChain.has(b)) || a === d.id || b === d.id) { links.add(l.id); nodes.add(a); nodes.add(b); }
  }
  return { d, nodes, links, rings };
}

/* ---------------- drawing ---------------- */
const MONO = '500 12px "Exo 2", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO_S = '500 11.5px "Exo 2", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SUN = '700 13px Orbitron, "Exo 2", system-ui, sans-serif';
const COUNT_FONT = fs => `700 ${fs}px Orbitron, "Exo 2", system-ui, sans-serif`;
const widths = new Map();
function textW(t, font){ const k = font + "|" + t; let w = widths.get(k); if (w == null) { ctx.font = font; w = ctx.measureText(t).width; widths.set(k, w); if (widths.size > 6000) widths.clear(); } return w; }

/* GitNexus look: flat discs on a near-black void, thin curved edges, one hairline orbit per body.
   With something lit, the rest shrinks and fades, and the lit body and its neighbours grow. */
function bodyScale(b, lit){
  if (!lit) return 1;
  if (b.id === lit.d.id) return 1.5;
  return lit.nodes.has(b.id) ? 1.15 : 0.6;
}
/* dash patterns are made once: a new array for every orbit and link, every frame, is garbage for nothing */
const NO_DASH = [], DASH_FOLDED = [3, 4], DASH_REF = [5, 5], DASH_GROUP = [3, 2.5];
const TAU = Math.PI * 2;

/* ---------------- lines far bigger than the screen ----------------
   Zoomed in deep, an orbit or a link can be millions of pixels long. The canvas lays dashes along the whole of a stroke,
   however much of it is off screen, and works in single precision, which at that size is pixels out (a very thin slice
   of a huge circle is not drawn at all). So such a line is stroked only where it crosses the screen, in pieces worked out
   here in full precision. Pieces start and end on a fixed grid along the line, and their dashes start where they fall on
   the whole line, so the dashes stay put as the view pans and as pieces come into view. */
const EDGE = 40;                 /* how far past the screen's edges a line is still drawn */
/* A dashed line is cut to the screen once it is longer than the screen, as its dashes then cost more than the cut.
   A solid line costs no more for its length, and is cut only where single precision starts to show. */
const HUGE = 1e5;
/* the angle ranges (within 0..2π) of the circle x, y, r that lie on the screen; null when all of it does */
function circleSpans(x, y, r){
  const L = -EDGE, T = -EDGE, R = W + EDGE, B = H + EDGE;
  if (x - r >= L && x + r <= R && y - r >= T && y + r <= B) return null;
  const as = [0, TAU];
  for (const v of [L, R]) { const d = (v - x) / r; if (d > -1 && d < 1) { const a = Math.acos(d); as.push(a, TAU - a); } }
  for (const v of [T, B]) { const d = (v - y) / r; if (d > -1 && d < 1) { const a = Math.asin(d); as.push(a < 0 ? a + TAU : a, Math.PI - a); } }
  as.sort((p, q) => p - q);
  /* between two crossings of the screen's edge lines the circle is wholly on screen or wholly off it */
  const out = [];
  for (let i = 1; i < as.length; i++) {
    const a0 = as[i - 1], a1 = as[i], m = (a0 + a1) / 2;
    if (!(a1 > a0)) continue;
    const px = x + r * Math.cos(m), py = y + r * Math.sin(m);
    if (px < L || px > R || py < T || py > B) continue;
    const o = out[out.length - 1]; if (o && o[1] === a0) o[1] = a1; else out.push([a0, a1]);
  }
  return out;
}
/* Stroke the arc of the circle x, y, r from angle `from` to `to` (at most a full turn), with the current style.
   A dashed one (period: the dash pattern's length) has its dashes counted from angle 0, as when the whole circle is drawn.
   Returns whether any of the circle is on screen. */
function strokeArc(x, y, r, from, to, period){
  const spans = circleSpans(x, y, r);
  if (spans && !spans.length) return false;
  /* all of it on screen, or not big enough to need cutting: drawn whole */
  if (!spans || r <= (period ? W + H : HUGE)) { ctx.beginPath(); ctx.arc(x, y, r, from, to); ctx.stroke(); return true; }
  /* the drawn range, moved to start within 0..2π; what is on screen repeats every full turn */
  const turn = TAU * Math.floor(from / TAU), f = from - turn, t = to - turn, g = 256 / r, pieces = [];
  for (const k of [0, TAU]) for (const [s0, s1] of spans) {
    const a0 = Math.max(f, s0 + k), a1 = Math.min(t, s1 + k);
    if (!(a1 > a0)) continue;
    /* out to the grid (every 256 px along the circle), but never past the ends of the drawn range: an open moon's gap stays exact */
    const p0 = Math.max(f, Math.floor(a0 / g) * g), p1 = Math.min(t, Math.ceil(a1 / g) * g), last = pieces[pieces.length - 1];
    if (last && p0 <= last[1]) last[1] = Math.max(last[1], p1); else pieces.push([p0, p1]);
  }
  for (const [a0, a1] of pieces) {
    if (period) ctx.lineDashOffset = (r * a0) % period;
    ctx.beginPath();
    if (a1 - a0 >= 0.01) ctx.arc(x, y, r, a0, a1);
    else {
      /* a thin slice of a huge circle: one curve through the tangents' meeting point, within a hair of the true arc */
      const m = (a0 + a1) / 2, q = r / Math.cos((a1 - a0) / 2);
      ctx.moveTo(x + r * Math.cos(a0), y + r * Math.sin(a0));
      ctx.quadraticCurveTo(x + q * Math.cos(m), y + q * Math.sin(m), x + r * Math.cos(a1), y + r * Math.sin(a1));
    }
    ctx.stroke();
  }
  if (period) ctx.lineDashOffset = 0;
  return pieces.length > 0;
}
/* the values of t at which one coordinate of the curve p0, p1, p2 equals v (the caller keeps those within 0..1) */
function crossings(p0, p1, p2, v, out){
  const a = p0 - 2 * p1 + p2, b = 2 * (p1 - p0), c = p0 - v;
  if (Math.abs(a) <= 1e-12 * (Math.abs(b) + Math.abs(c))) { if (b) out.push(-c / b); return; }
  const d = b * b - 4 * a * c; if (d < 0) return;
  const q = -(b + (b < 0 ? -1 : 1) * Math.sqrt(d)) / 2;
  out.push(q / a); if (q) out.push(c / q);
}
/* the stretches [t0, t1] of the quadratic curve x0, y0 / x1, y1 / x2, y2 that lie on the screen */
function curveSpans(x0, y0, x1, y1, x2, y2){
  const L = -EDGE, T = -EDGE, R = W + EDGE, B = H + EDGE, ts = [0, 1];
  crossings(x0, x1, x2, L, ts); crossings(x0, x1, x2, R, ts); crossings(y0, y1, y2, T, ts); crossings(y0, y1, y2, B, ts);
  const s = ts.filter(t => t >= 0 && t <= 1).sort((p, q) => p - q), out = [];
  for (let i = 1; i < s.length; i++) {
    if (!(s[i] > s[i - 1])) continue;
    const t = (s[i - 1] + s[i]) / 2, u = 1 - t, x = u * u * x0 + 2 * u * t * x1 + t * t * x2, y = u * u * y0 + 2 * u * t * y1 + t * t * y2;
    if (x < L || x > R || y < T || y > B) continue;
    const o = out[out.length - 1]; if (o && o[1] === s[i - 1]) o[1] = s[i]; else out.push([s[i - 1], s[i]]);
  }
  return out;
}
/* how far along the curve the point at t lies (exact), so a piece's dashes start where they fall on the whole curve */
function lengthTo(x0, y0, x1, y1, x2, y2, t){
  const ax = x1 - x0, ay = y1 - y0, bx = x0 - 2 * x1 + x2, by = y0 - 2 * y1 + y2;
  const a = bx * bx + by * by, b = ax * bx + ay * by, c = ax * ax + ay * ay;
  if (a <= 1e-12 * c) return 2 * Math.sqrt(c) * t;
  const p0 = b / a, m = Math.max(c / a - p0 * p0, 1e-300), sm = Math.sqrt(m), g = p => p * Math.sqrt(p * p + m) + m * Math.asinh(p / sm);
  return Math.sqrt(a) * (g(t + p0) - g(p0));
}
/* Stroke a quadratic curve with the current style; a big one only where it crosses the screen. A dashed one (period: the dash
   pattern's length) has its dashes counted from its start, as when it is drawn whole. */
function strokeCurve(ax, ay, cx, cy, bx, by, period){
  const poly = Math.hypot(cx - ax, cy - ay) + Math.hypot(bx - cx, by - cy);   /* the curve is no longer than this */
  if (poly <= (period ? W + H : HUGE)) { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(cx, cy, bx, by); ctx.stroke(); return; }
  /* pieces start and end on a grid of t, at most 256 px apart along the curve */
  const g = 256 / poly, pieces = [];
  for (const [s0, s1] of curveSpans(ax, ay, cx, cy, bx, by)) {
    const t0 = Math.floor(s0 / g) * g, t1 = Math.min(1, Math.ceil(s1 / g) * g), last = pieces[pieces.length - 1];
    if (last && t0 <= last[1]) last[1] = Math.max(last[1], t1); else pieces.push([t0, t1]);
  }
  for (const [t0, t1] of pieces) {
    const u = 1 - t0, v = 1 - t1, f = t1 - t0;
    const sx = u * u * ax + 2 * u * t0 * cx + t0 * t0 * bx, sy = u * u * ay + 2 * u * t0 * cy + t0 * t0 * by;
    const ex = v * v * ax + 2 * v * t1 * cx + t1 * t1 * bx, ey = v * v * ay + 2 * v * t1 * cy + t1 * t1 * by;
    if (period) ctx.lineDashOffset = lengthTo(ax, ay, cx, cy, bx, by, t0) % period;
    /* the piece of a quadratic curve is one too: its control point lies along the tangent at its start */
    ctx.beginPath(); ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(sx + f * (u * (cx - ax) + t0 * (bx - cx)), sy + f * (u * (cy - ay) + t0 * (by - cy)), ex, ey);
    ctx.stroke();
  }
  if (period) ctx.lineDashOffset = 0;
}
function draw(){
  const c = A.cam;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  /* the backdrop is the canvas's CSS background (index.html), which the browser paints once; each frame only clears the canvas */
  ctx.clearRect(0, 0, W, H);
  const O = A.O; if (!O) return;
  const lit = litSet();

  /* everything is drawn in screen pixels, worked out here in full precision: the canvas's own transform
     loses precision at the very large zooms needed for deep moons */
  const k = c.k, X = b => c.x + k * b.x, Y = b => c.y + k * b.y;
  const onScreen = (x, y, r) => x + r > -40 && y + r > -40 && x - r < W + 40 && y - r < H + 40;
  /* a line's colour, width and dash are set only when they change: hundreds of orbits and links share a few looks */
  let penC, penW, penD;
  const pen = (col, w, d) => { if (col !== penC) ctx.strokeStyle = penC = col; if (w !== penW) ctx.lineWidth = penW = w; if (d !== penD) ctx.setLineDash(penD = d); };
  /* orbits: hairlines, one per body. Seen from afar, a big group's orbits lie closer together than a pixel or two and
     cannot be told apart, so an orbit within 2 px of the last one drawn the same way (lit or not, dashed or not) is left
     out. Radii are compared as drawn: while orbits grow or shrink (ring.rd) they need not be in order.
     Lit orbits are all drawn, so a lit system keeps its glow, unless hundreds are lit at once. */
  const lastR = [0, 0, 0, 0], thinLit = !!lit && lit.rings.size > 300;
  for (const b of O.order) {
    if (!b.rings.length) continue;
    const x = X(b), y = Y(b);
    lastR.fill(-Infinity);
    for (const ring of b.rings) {
      const rr = (ring.rd ?? ring.r) * k;
      if (rr < 1.5 || !onScreen(x, y, rr)) continue;
      const on = lit?.rings.has(ring.id), look = (on ? 2 : 0) + (ring.grp.folded ? 1 : 0);
      if ((!on || thinLit) && Math.abs(rr - lastR[look]) < 2) continue;
      /* an open body's own orbit stops at the edge of its system, so the line never runs through its moons */
      const m = ring.members[0], mr = m.sysR ? (m.sysR + m.size) * k : 0;
      if (mr > 2 && mr >= 2 * rr) continue;
      const mx = X(m), my = Y(m), md = Math.hypot(mx - x, my - y);
      let from = 0, to = TAU;
      if (mr > 2 && md > 0) { const ma = Math.atan2(my - y, mx - x), hw = 2 * Math.asin(Math.min(1, mr / (2 * rr))); from = ma + hw; to = ma - hw + Math.PI * 2; }
      ctx.globalAlpha = lit ? (on ? 0.3 : 0.025) : (b.depth === 0 ? 0.07 : 0.055);
      pen(colour(ring.color), on ? 1 : 0.6, ring.grp.folded ? DASH_FOLDED : NO_DASH);
      if (strokeArc(x, y, rr, from, to, ring.grp.folded ? 7 : 0)) lastR[look] = rr;
    }
  }
  /* edges: curved, like Sigma's curved edge program. The tree's branches bend upward, more the further to the side they
     go, and are thickest at the root, thinner at each level up. */
  const tree = O.mode === "tree";
  for (const l of O.links) {
    const on = lit?.links.has(l.id), ax = X(l.a), ay = Y(l.a), bx = X(l.b), by = Y(l.b);
    const dx = bx - ax, dy = by - ay, spoke = l.kind === "spoke", bend = !spoke ? 0.26 : tree ? XO.Orbits.branchBend(l.b, dx, Math.hypot(dx, dy)) : 0.1, cx = (ax + bx) / 2 - dy * bend, cy = (ay + by) / 2 + dx * bend;
    /* the curve lies inside the triangle of its ends and its control point, so that decides whether it can show:
       by its ends alone, a curve whose bulge crosses the edge of the screen would pop in and out */
    if (Math.max(ax, bx, cx) < -40 || Math.max(ay, by, cy) < -40 || Math.min(ax, bx, cx) > W + 40 || Math.min(ay, by, cy) > H + 40) continue;
    if (Math.hypot(dx, dy) < 1) continue;
    ctx.globalAlpha = lit ? (on ? 0.95 : 0.04) : (spoke ? 0.32 : 0.45);
    pen(colour(l.color), on ? 2.4 : !spoke ? 1.1 : tree ? 0.9 + 1.5 * Math.pow(0.55, l.a.depth) : 0.9, spoke ? NO_DASH : DASH_REF);
    strokeCurve(ax, ay, cx, cy, bx, by, spoke ? 0 : 10);
  }
  ctx.setLineDash(NO_DASH);
  /* bodies that are folding away */
  for (const g of O.ghosts) { const x = X(g), y = Y(g), r = g.size * k * g.life; if (r < 0.3 || !onScreen(x, y, r)) continue; ctx.globalAlpha = Math.max(0, g.life) * 0.6 * (lit ? 0.2 : 1); ctx.fillStyle = colour(g.color); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
  /* bodies */
  for (const b of O.order) {
    const n = b.type === "group" ? b.count : b.kids || 0;
    const x = X(b), y = Y(b), r = Math.max(b.size * k * bodyScale(b, lit), n > 0 ? countR(n) : 1.2);
    if (!onScreen(x, y, r * 3)) continue;
    const on = !lit || lit.nodes.has(b.id), col = colour(b.color);
    if (b.depth === 0 || b.id === A.sel || (lit && b.id === lit.d.id)) {
      const gr = r * (b.depth === 0 ? 3.4 : 2.6);
      ctx.globalAlpha = on ? (b.depth === 0 ? 0.55 : 0.4) : 0.08;
      ctx.drawImage(glowSprite(col), x - gr, y - gr, gr * 2, gr * 2);
    }
    ctx.globalAlpha = on ? 1 : 0.22;
    if (b.type === "group") {
      ctx.fillStyle = "#101018"; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.setLineDash(DASH_GROUP); ctx.stroke(); ctx.setLineDash(NO_DASH);
      drawCount(n, x, y, r, "#f5f5f7");
    } else {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      /* how many direct child elements it has; nothing when it has none */
      drawCount(n, x, y, r, XO.sources.inkFor(col));
    }
    if (b.isOpen && b.depth > 0 && r > 2) { ctx.globalAlpha = on ? 0.6 : 0.15; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r + 3.5, 0, 7); ctx.stroke(); }
    if (b.id === A.hover || b.id === A.sel) { ctx.globalAlpha = b.id === A.sel ? 0.9 : 0.5; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 4, 0, 7); ctx.stroke(); }
  }
  /* search hit: a cyan pulse; it ends when its time is up or its body is folded away */
  const P = A.pulse, pb = P && O.bodies.get(P.id);
  if (P) {
    const t = (performance.now() - P.t0) / 1000;
    if (!pb || t > 2.4) A.pulse = null;
    else {
      const x = X(pb), y = Y(pb), r = Math.max(pb.size * k * bodyScale(pb, lit), 3);
      for (let i = 0; i < 2; i++) { const p = ((t * 1.25 + i * 0.5) % 1); ctx.globalAlpha = (1 - p) * 0.9; ctx.strokeStyle = CYAN; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 4 + p * 26, 0, 7); ctx.stroke(); }
    }
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawLabels(lit);
  /* the counts change only with a rebuild (a new order); writing text to the page, even the same text,
     makes the browser restyle and lay it out again */
  if (counted !== O.order) { counted = O.order; countText = A.src ? `${O.order.filter(b => b.type !== "group").length} of ${A.src.total.toLocaleString()} elements shown` + (O.mode === "orbit" ? ` · ${O.order.reduce((s, b) => s + b.rings.length, 0)} orbits` : "") : ""; }
  setText("status", countText);
  setText("zoomPct", A.src ? `zoom ${zoomPct(c.k)}%` : "");
}
let counted = null, countText = "";
/* the zoom as a percentage: whole numbers, except under 1% (a big file shown in full), where one figure still says something */
const zoomPct = k => { const p = k * 100; return p >= 1 ? Math.round(p) : +p.toPrecision(1); };
const shownText = {};
function setText(id, t){ if (shownText[id] !== t) { shownText[id] = t; $(id).textContent = t; } }
const S = (b) => [A.cam.x + A.cam.k * b.x, A.cam.y + A.cam.k * b.y];
/* the smallest on-screen radius that still holds a number of this many digits */
const countR = n => Math.max(5.5, String(n).length * 2.4 + 1.5);
function drawCount(n, x, y, r, ink){
  if (!(n > 0)) return;
  const t = String(n);
  let fs = Math.round(Math.min(16, Math.max(7, r * (t.length > 2 ? 0.62 : 0.85))));
  let font = COUNT_FONT(fs);
  while (fs > 7 && textW(t, font) > r * 2) { fs--; font = COUNT_FONT(fs); }
  ctx.font = font; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = ink;
  ctx.fillText(t, x, y + 0.5); ctx.textAlign = "left";
}

/* Where labels have gone, and the bodies' discs, filed in a coarse grid over the screen: a new label is checked only against
   those near it, not against every one placed so far. A label is placed only if its top-left corner is on screen (give or
   take a margin), so a rectangle wholly outside that area can never be in the way, and is not filed. */
const CELL = 64;
function labelGrid(){
  const x0 = -50, y0 = -20, x1 = W + 50, y1 = H + 20, cols = Math.floor((x1 - x0) / CELL) + 1, rows = Math.floor((y1 - y0) / CELL) + 1, cells = new Array(cols * rows);
  const col = x => Math.min(cols - 1, Math.max(0, Math.floor((x - x0) / CELL))), row = y => Math.min(rows - 1, Math.max(0, Math.floor((y - y0) / CELL)));
  return {
    /* a rectangle that overlaps a filed one shares a cell with it: the one holding the top-left corner of their overlap */
    free(x, y, w, h){
      if (x < x0 || y < y0 || x > x1 || y > y1) return false;
      for (let j = row(y), j1 = row(y + h); j <= j1; j++) for (let i = col(x), i1 = col(x + w); i <= i1; i++) {
        const list = cells[j * cols + i];
        if (list) for (const p of list) if (x < p.x + p.w && x + w > p.x && y < p.y + p.h && y + h > p.y) return false;
      }
      return true;
    },
    add(x, y, w, h){
      if (x + w < x0 || y + h < y0 || x > x1 || y > y1) return;
      const p = { x, y, w, h };
      for (let j = row(y), j1 = row(y + h); j <= j1; j++) for (let i = col(x), i1 = col(x + w); i <= i1; i++) (cells[j * cols + i] || (cells[j * cols + i] = [])).push(p);
    }
  };
}
/* Labels are placed most important first; one that would overlap a placed label tries other sides, then is skipped. */
function drawLabels(lit){
  const O = A.O, c = A.cam, k = c.k, grid = labelGrid(), free = grid.free;
  const pill = (x, y, w, h, stroke, lw = 1) => { ctx.fillStyle = "#12121c"; ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.fill(); ctx.stroke(); };
  /* how far from its centre a body's label sits: its disc as drawn, or the circle that holds its count */
  const reach = b => { const n = b.type === "group" ? b.count : b.kids || 0; return Math.max(b.size * k * bodyScale(b, lit), n > 0 ? countR(n) : 0); };
  /* a label's text, font, width and height */
  const labelText = (b, hot) => { const t = b.type === "group" ? `${b.label} · ${b.count}` : clip(b.label, hot ? 52 : 30), font = hot || b.depth <= 1 ? MONO : MONO_S; return [t, font, textW(t, font) + (hot ? 16 : 4), hot ? 21 : 15]; };
  /* bodies' circles block labels too, so names never sit on top of a planet */
  for (const b of O.order) { const r = reach(b); if (r > 3) grid.add(c.x + k * b.x - r, c.y + k * b.y - r, 2 * r, 2 * r); }
  const cands = [];
  for (const b of O.order) {
    const on = lit?.nodes.has(b.id);
    if (lit && !on && b.depth > 0) continue;
    if (!on && b.depth > 1 && b.size * k < 3.2) continue;
    const x = c.x + k * b.x, y = c.y + k * b.y, r = reach(b);
    /* Every place tried for a label (beside, below or above its body) must start on screen. A body too far off screen for
       any of them is passed over; the bounds below are those places' own, so no label that could be placed is missed.
       The sun's and the lit body's labels are always placed. */
    if (b.depth > 0 && !(lit && b.id === lit.d.id)) {
      if (x < -56 - r || y < -24 - r || y > H + 24 + r + (on ? 21 : 15)) continue;
      if (x > W + 56 + r && x > W + 56 + r + labelText(b, on)[2]) continue;
    }
    const pri = lit && b.id === lit.d.id && b.depth ? -2e9 : b.depth === 0 ? -1e9 : (on ? 0 : 1e6) + (b.id === A.sel || b.id === A.hover ? 0 : 1e5) + b.depth * 1e3 - b.size;
    cands.push([pri, b, x, y, r]);
  }
  cands.sort((p, q) => p[0] - q[0]);
  /* the sun's name sits under it */
  ctx.textBaseline = "middle";
  for (const [, b, x, y, r] of cands) {
    const hot = lit?.nodes.has(b.id), main = lit && b.id === lit.d.id;
    if (b.depth === 0) {
      const t = clip(b.label, 40), w = textW(t, SUN) + 18, h = 24, rx = x - w / 2, ry = y + r + 8;
      if (!free(rx, ry, w, h) && lit) continue;
      grid.add(rx, ry, w, h); ctx.font = SUN; pill(rx, ry, w, h, colour(b.color), 2);
      ctx.fillStyle = "#f5f5f7"; ctx.textAlign = "center"; ctx.fillText(t, x, ry + h / 2 + 0.5); ctx.textAlign = "left";
      continue;
    }
    const [t, font, w, h] = labelText(b, hot);
    /* the lit body's name sits in a pill above it, as GitNexus draws a hovered node; others go beside */
    const above = [x - w / 2, y - r - 8 - h], tries = main ? [above, [x - w / 2, y + r + 8]] : [[x + r + 6, y - h / 2], [x - r - 6 - w, y - h / 2], [x - w / 2, y + r + 4], [x - w / 2, y - r - 4 - h]];
    for (const [lx, ly] of tries) {
      if (!free(lx, ly, w, h) && !main) continue;
      grid.add(lx, ly, w, h);
      ctx.font = font;
      if (hot) { pill(lx, ly, w, h, colour(b.color) + (main ? "" : "99"), main ? 2 : 1); ctx.fillStyle = "#f5f5f7"; ctx.fillText(t, lx + 8, ly + h / 2 + 0.5); }
      else { ctx.fillStyle = b.depth <= 1 ? "rgba(228,228,237,.9)" : "rgba(136,136,160,.9)"; ctx.fillText(t, lx + 2, ly + h / 2 + 0.5); }
      break;
    }
  }
  /* labels on the lit body's id-reference lines (none when more than 10 lines are lit), then orbit names */
  if (lit && lit.links.size <= 10) for (const l of O.links) {
    if (!lit.links.has(l.id) || !l.short) continue;
    const [ax, ay] = S(l.a), [bx, by] = S(l.b), mx = (ax + bx) / 2, my = (ay + by) / 2;
    const w = textW(l.short, MONO_S) + 10, h = 17;
    for (const [dx, dy] of [[0, 0], [0, -16], [0, 16], [0, -32], [0, 32], [w * 0.6, 0], [-w * 0.6, 0]]) {
      const rx = mx - w / 2 + dx, ry = my - h / 2 + dy;
      if (!free(rx, ry, w, h)) continue;
      grid.add(rx, ry, w, h); pill(rx, ry, w, h, colour(l.color) + "77");
      ctx.font = MONO_S; ctx.fillStyle = colour(l.color); ctx.fillText(l.short, rx + 5, ry + h / 2 + 0.5);
      break;
    }
  }
  /* each group of neighbouring orbits is named once, on its innermost orbit */
  for (const b of O.order) for (const ring of b.rings) {
    if (!ring.first || ring.grp.count < 2 && !ring.grp.folded || !(b.depth === 0 || lit?.rings.has(ring.id) || b.id === A.sel || (lit && b.id === lit.d.id))) continue;
    const [x, y] = S(b), rr = ring.r * k;
    if (rr < 40) continue;
    const g = ring.grp, t = `${g.title} · ${g.count}${g.folded ? " (folded)" : ""}`, w = textW(t, MONO_S) + 6, rx = x - w / 2, ry = y - rr - 8;
    if (!free(rx, ry, w, 15)) continue;
    grid.add(rx, ry, w, 15); ctx.globalAlpha = lit && !lit.rings.has(ring.id) ? 0.25 : 0.85;
    ctx.font = MONO_S; ctx.fillStyle = colour(ring.color); ctx.fillText(t, rx + 3, ry + 7.5); ctx.globalAlpha = 1;
  }
}

/* ---------------- hit test and pointer ---------------- */
function hit(sx, sy, slop = 4){
  const O = A.O; if (!O) return null;
  let best = null, bd = Infinity;
  for (const b of O.order) {
    const n = b.type === "group" ? b.count : b.kids || 0;
    const [x, y] = S(b), r = Math.max(b.size * A.cam.k, 6, n > 0 ? countR(n) : 0) + slop, d = Math.hypot(x - sx, y - sy);
    if (d < r && d < bd) { best = b; bd = d; }
  }
  return best;
}
const pts = new Map();
canvas.addEventListener("pointerdown", e => {
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.offsetX, e.offsetY]);
  if (pts.size === 2) {
    const [p, q] = [...pts.values()]; A.pinch = { d:Math.hypot(p[0] - q[0], p[1] - q[1]), k:A.cam.k };
    if (A.ptr?.dragging) { A.ptr.body.dragging = false; A.ptr.body.free = true; }
    A.ptr = null; canvas.classList.remove("grabbing"); return;
  }
  A.mslop = e.pointerType === "touch" ? 16 : 4;
  const b = hit(e.offsetX, e.offsetY, A.mslop);
  A.ptr = { id:e.pointerId, x0:e.offsetX, y0:e.offsetY, x:e.offsetX, y:e.offsetY, body:b, moved:false, dragging:false };
  hideTip();
});
canvas.addEventListener("pointermove", e => {
  if (pts.has(e.pointerId)) pts.set(e.pointerId, [e.offsetX, e.offsetY]);
  if (A.pinch && pts.size === 2) {
    const [p, q] = [...pts.values()], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    zoomAt((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, A.pinch.k * d / A.pinch.d / A.cam.k); return;
  }
  const P = A.ptr;
  if (P && P.id === e.pointerId) {
    const dx = e.offsetX - P.x, dy = e.offsetY - P.y;
    if (!P.moved && Math.hypot(e.offsetX - P.x0, e.offsetY - P.y0) > 4) { P.moved = true; if (P.body && P.body.parent) { P.dragging = true; P.body.dragging = true; } else canvas.classList.add("grabbing"); }
    if (P.moved) {
      if (P.dragging) { P.body.x = (e.offsetX - A.cam.x) / A.cam.k; P.body.y = (e.offsetY - A.cam.y) / A.cam.k; }
      else { A.cam.x += dx; A.cam.y += dy; A.follow = null; A.camTo = null; }
      kick();
    }
    P.x = e.offsetX; P.y = e.offsetY; return;
  }
  A.mx = e.offsetX; A.my = e.offsetY; A.mslop = e.pointerType === "touch" ? 16 : 4;
  setHover(hit(e.offsetX, e.offsetY, A.mslop));
});
function endPointer(e){
  pts.delete(e.pointerId);
  if (pts.size < 2) A.pinch = null;
  const P = A.ptr; if (!P || P.id !== e.pointerId) return;
  A.ptr = null; canvas.classList.remove("grabbing");
  if (P.dragging) { P.body.dragging = false; P.body.free = true; kick(); return; }
  if (!P.moved && e.type === "pointerup") {
    if (P.body) {
      /* a double-click must not open and immediately fold the same body */
      const now = performance.now();
      if (A.lastClick && A.lastClick.id === P.body.id && now - A.lastClick.t < 350) return;
      A.lastClick = { id:P.body.id, t:now };
      clickBody(P.body);
    } else select(null);
  }
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("pointerleave", () => { A.mx = null; if (!A.ptr) setHover(null); });
canvas.addEventListener("contextmenu", e => e.preventDefault());
canvas.addEventListener("dblclick", e => { if (!hit(e.offsetX, e.offsetY)) fit(true); });
canvas.addEventListener("wheel", e => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015))); }, { passive:false });
function zoomAt(sx, sy, f){
  const c = A.cam, k = Math.max(minZoom(), Math.min(MAX_ZOOM, c.k * f));
  A.camTo = null; A.followK = null;
  if (A.follow) { c.k = k; kick(); return; }
  c.x = sx - (sx - c.x) * (k / c.k); c.y = sy - (sy - c.y) * (k / c.k); c.k = k; kick();
}
canvas.addEventListener("keydown", e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;   /* plain keys only: Ctrl C, ⌘A and the like stay the browser's */
  const key = e.key.toLowerCase();                   /* letters work with Caps Lock or Shift too */
  if (e.key === "Escape") select(null);
  else if (key === "f") fit(true);
  else if (e.key === " ") { e.preventDefault(); if (A.view === "orbit") setPlay(!A.playing); }
  else if (e.key === "+" || e.key === "=") zoomAt(W / 2, H / 2, 1.25);
  else if (e.key === "-") zoomAt(W / 2, H / 2, 0.8);
  else if (e.key === "Enter" && A.sel) { const b = A.O.bodies.get(A.sel); if (b) clickBody(b); }
  /* a held key keeps zooming, but builds the whole map only once */
  else if (key === "a" && !e.repeat) showAll();
  else if (key === "c" && !e.repeat) foldAll();
});

/* ---------------- hover, tooltip, selection ---------------- */
function setHover(b){
  const id = b ? b.id : null;
  canvas.classList.toggle("pointing", !!b);
  if (id === A.hover) return;
  A.hover = id; kick();
  if (!b) { hideTip(); return; }
  const tip = $("tip"); tip.innerHTML = tipHtml(b); tip.classList.toggle("wide", !b.parent); tip.hidden = false; placeTip(b);
}
function hideTip(){ $("tip").hidden = true; }
function chainText(b){
  return A.O.chainOf(b).map((x, i) => (i ? `<span class="s">→ ${esc(hopText(x))} →</span> ` : "") + `<b>${esc(clip(x.label, 34))}</b>`).join(" ");
}
/* how a body hangs off its parent: its tag */
function hopText(x){ return x.type === "group" ? x.label : x.kind || ""; }
const hopColour = x => colour(x.color);
const canToggle = b => b.type !== "group" && A.src.canOpen(b.id);
function headerHtml(h, max = 12, per = 8){
  if (!h?.length) return "";
  const rows = h.slice(0, max).map(f => `<dt${f.items ? ' class="grp"' : ""}>${esc(f.key)}</dt><dd${f.items ? ' class="grp"' : ""}>${f.items ? f.items.slice(0, per).map(i => `<div><span class="s">${esc(i.key)}:</span> ${esc(clip(i.value, 120))}</div>`).join("") + (f.items.length > per ? `<div class="s">… ${f.items.length - per} more</div>` : "") : esc(clip(f.value, 160))}</dd>`).join("");
  return `<dl class="hdr">${rows}</dl>` + (h.length > max ? `<div class="c">… and ${h.length - max} more fields</div>` : "");
}
function tipHtml(b){
  const n = A.src.node(b.id), kind = b.type === "group" ? `${b.count} × ${esc(b.label)} (folded)` : esc(n?.kind || "");
  /* the first sentence of what defines it, or the listed value its text is */
  const ex = b.type === "group" ? null : A.src.explain(b.id);
  const dline = ex?.def?.text ? clip(XO.explain.firstSentence(ex.def.text), 120) : ex?.value?.label != null ? clip(ex.value.label + (ex.value.text ? ": " + XO.explain.firstSentence(ex.value.text) : ""), 120) : "";
  const act = b.type === "group" ? "Click to spread them out" : A.sel !== b.id ? "Click to centre it" + (canToggle(b) ? "; click again to show its child elements" : "") : canToggle(b) ? (b.isOpen ? "Click again to fold its child elements" : "Click again to show its child elements") : "";
  const cross = A.O.links.filter(l => l.kind !== "spoke" && (l.a === b || l.b === b)).length;
  const head = b.parent ? "" : headerHtml(A.src.header());
  return `<b>${esc(b.label)}</b><span class="s">${kind}</span>${dline ? `<div class="c">${esc(dline)}</div>` : ""}${head}${b.parent ? `<div class="c">${chainText(b)}</div>` : ""}${cross ? `<div class="c">${cross} more link${cross === 1 ? "" : "s"} (dashed)</div>` : ""}${act ? `<div class="c">${act}</div>` : ""}`;
}
/* Try spots all round the body; keep the one covering least of it, its lit neighbours and the panels. */
function placeTip(b){
  const tip = $("tip"), [sx, sy] = S(b), rr = b.size * A.cam.k + 6, w = tip.offsetWidth, h = tip.offsetHeight;
  const avoid = [{ x0:sx - rr, y0:sy - rr, x1:sx + rr, y1:sy + rr, wt:1000 }];
  for (const el of [$("top"), $("side"), $("leftcol"), $("rootLine"), $("ctrls"), $("foot")]) if (el && !el.hidden) { const r = el.getBoundingClientRect(); avoid.push({ x0:r.left, y0:r.top, x1:r.right, y1:r.bottom, wt:30 }); }
  const lit = litSet();
  if (lit) for (const id of lit.nodes) { const n = A.O.bodies.get(id); if (n && n !== b) { const [x, y] = S(n); avoid.push({ x0:x - 14, y0:y - 14, x1:x + 14, y1:y + 14, wt:4 }); } }
  const base = b.parent ? Math.atan2(b.y - b.parent.y, b.x - b.parent.x) : Math.PI / 4;
  let best = null;
  for (let i = 0; i < 16; i++) {
    const a = base + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * Math.PI / 8;
    let x = sx + Math.cos(a) * (rr + 12 + w / 2) - w / 2, y = sy + Math.sin(a) * (rr + 12 + h / 2) - h / 2;
    x = Math.max(8, Math.min(W - w - 8, x)); y = Math.max(8, Math.min(H - h - 8, y));
    let cost = i * 0.5;
    for (const o of avoid) { const ox = Math.min(x + w, o.x1) - Math.max(x, o.x0), oy = Math.min(y + h, o.y1) - Math.max(y, o.y0); if (ox > 0 && oy > 0) cost += o.wt * ox * oy / 100; }
    if (!best || cost < best.c) best = { x, y, c:cost };
    if (cost < 1) break;
  }
  tip.style.left = best.x + "px"; tip.style.top = best.y + "px";
}
function select(b){
  A.sel = b ? b.id : null;
  renderRename();
  if (!b) { A.follow = null; $("side").hidden = true; kick(); return; }
  renderSide(b); kick();
}
function clickBody(b){
  hideTip(); A.hover = null;
  const O = A.O;
  if (b.type === "group") {
    O.spread.add(b.id); O.build();
    const p = O.bodies.get(b.parent.id); select(p); followBody(p, true); return;
  }
  /* first click: centre it; the next click shows its children */
  if (A.sel !== b.id) { select(b); followBody(b, false); return; }
  toggleOpen(b);
}
/* show every child of b, spread out (no folded groups), or fold them again */
function toggleOpen(b){
  const O = A.O;
  let opened = false;
  if (canToggle(b)) {
    if (O.open.has(b.id)) O.open.delete(b.id);
    else {
      O.open.add(b.id); opened = true;
      for (const g of A.src.groups(b.id)) O.spread.add(b.id + ">" + g.key);
    }
    O.build(); O.step(0, false);
  }
  const nb = O.bodies.get(b.id);
  select(nb); followBody(nb, opened);
}
/* show every element in the file, then fit the whole map on screen; the selected body stays selected */
function showAll(){
  const O = A.O; if (!O) return;
  O.openAll(); O.build(); O.step(0, false);
  const s = O.bodies.get(A.sel); if (s) renderSide(s);
  fit(true);
}
/* fold every orbit back into the one circle of the root element */
function foldAll(){
  const O = A.O; if (!O) return;
  O.open = new Set(); O.spread.clear(); select(null); O.build();
  setTimeout(() => fit(true), 250); kick();
}

/* ---------------- side panel ---------------- */
/* The What this is box: plain words for every element, then what defines its name (from this file or a dictionary),
   the listed value its text is, and when nothing defines it, the way to open a dictionary that does. */
function whatHtml(ex, info){
  const out = [`<h3>What this is</h3><p>${esc(ex.what)}</p>`];
  for (const g of ex.glossary) out.push(`<div class="s">&lt;${esc(g.name)}&gt;: ${esc(g.text)}</div>`);
  const d = ex.def, v = ex.value;
  const facts = d => { const t = Object.entries(d.extra).map(([k, x]) => `${k} ${x}`); if (d.values) t.push(XO.explain.count(d.values, "listed value")); return t.length ? `<div class="tags">${t.map(f => `<span class="tag">${esc(f)}</span>`).join("")}</div>` : ""; };
  if (d) {
    const code = d.code && d.code !== d.name ? ` <span class="s">(code ${esc(d.code)})</span>` : "";
    const lead = d.defines ? `This element defines the ${esc(d.kind)} <b>“${esc(d.name)}”</b>${code}${d.parentName ? `, a value of “${esc(d.parentName)}”` : ""}` : `<b>${esc(d.name)}</b>${code} <span class="s">· ${esc(d.kind)} · from ${esc(d.from)}</span>`;
    out.push(`<div class="def"><div class="dh">${lead}</div>${d.text ? `<p>${esc(clip(d.text, 600))}</p>` : `<p class="s">No definition given.</p>`}${d.remarks ? `<p class="s">${esc(clip(d.remarks, 300))}</p>` : ""}${d.aliases.length ? `<div class="s">Also called ${d.aliases.map(esc).join(", ")}</div>` : ""}${facts(d)}${d.id ? `<button type="button" class="chip" data-find="${esc(d.id)}">Go to the definition</button>` : ""}${d.parentId ? `<button type="button" class="chip" data-find="${esc(d.parentId)}">Go to “${esc(clip(d.parentName, 30))}”</button>` : ""}</div>`);
  }
  if (v) {
    if (v.label != null) out.push(`<div class="def"><div class="dh"><b>“${esc(v.label)}”</b>${v.code && v.code !== v.label ? ` = code ${esc(v.code)}` : ""} <span class="s">· a listed value of “${esc(v.listName)}” · from ${esc(v.from)}</span></div>${v.text ? `<p>${esc(clip(v.text, 400))}</p>` : ""}${v.listId ? `<button type="button" class="chip" data-find="${esc(v.listId)}">Go to “${esc(clip(v.listName, 30))}”</button>` : ""}</div>`);
    else out.push(`<div class="def s">${v.total === 1 ? "Not the one listed value" : `Not one of the ${v.total} listed values`} of “${esc(v.listName)}” (${esc(v.from)}): ${v.allowed.map(esc).join(", ")}${v.total > v.allowed.length ? ", …" : ""}.</div>`);
  }
  if (!d && !v && info && !info.header) {
    const root = A.src.explain(A.src.rootId);
    out.push(`<div class="def s">No definition of &lt;${esc(XO.names.show(info.tag))}&gt; in this file${ex.dictionaries.length ? " or in " + esc(ex.dictionaries.join(", ")) : ""}.${root.schemaHint ? ` The file names its schema: ${esc(root.schemaHint)}.` : ""} <button class="link" type="button" data-act="dict">Open a schema or catalogue that defines it…</button></div>`);
  }
  return `<div class="box what">${out.join("")}</div>`;
}
function renderSide(b){
  const side = $("side"), info = b.type === "group" ? null : A.src.info(b.id), O = A.O, ex = info ? A.src.explain(b.id) : null;
  const chain = O.chainOf(b);
  const chainHtml = chain.map((x, i) => (i ? `<span class="hop"><span class="dot" style="background:${hopColour(x)}"></span>${esc(hopText(x))} →</span>` : "")
    + (x === b ? `<span class="chip here">${esc(clip(x.label, 30))}</span>` : `<button type="button" class="chip" data-sel="${esc(x.id)}">${esc(clip(x.label, 30))}</button>`)).join(" ");
  const parts = [];
  const col = colour(b.color);
  parts.push(`<div class="kind"><span class="dot" style="background:${col};box-shadow:0 0 8px ${col}"></span>${esc(b.type === "group" ? "Folded group" : info?.kind || "")}</div>`);
  parts.push(`<h2>${esc(b.type === "group" ? `${b.count} × ${b.label}` : info?.title || b.label)}</h2>`);
  if (info?.code) parts.push(`<div class="code">${esc(info.code)}</div>`);
  if (b.parent) parts.push(`<div class="box"><h3>Where it comes from</h3><div class="chain">${chainHtml}</div></div>`);
  if (ex) parts.push(whatHtml(ex, info));
  if (info?.header?.length) parts.push(`<div class="box"><h3>About this file</h3>${headerHtml(info.header, 60, 40)}</div>`);
  if (info?.def) parts.push(`<p>${esc(info.def)}</p>`);
  if (info?.facts?.length) parts.push(`<div class="tags">${info.facts.map(f => `<span class="tag">${esc(f)}</span>`).join("")}</div>`);
  /* under an attribute's value, what the glossary or a dictionary says its name means */
  if (info?.attrs?.length) parts.push(`<div><h3>Attributes</h3><dl class="attrs">${info.attrs.slice(0, 40).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(clip(v, 200))}${ex.attrs.has(k) ? `<div class="s">${esc(ex.attrs.get(k))}</div>` : ""}</dd>`).join("")}</dl></div>`);
  if (info?.orbits?.length) parts.push(`<div><h3>${A.view === "tree" ? "Its branches" : "Its orbits"}</h3><div class="tags">${info.orbits.map(o => `<span class="tag" style="border-color:${colour(o.color)};color:${colour(o.color)}">${esc(o.title)} ${o.count}</span>`).join("")}</div></div>`);
  const linkRow = (id, text, c) => `<div class="it"><span class="dot" style="background:${colour(c)}"></span><button type="button" class="chip" data-find="${esc(id)}">${esc(clip(text, 48))}</button></div>`;
  if (info?.linksOut?.length) parts.push(`<div><h3>Points to</h3><div class="list">${info.linksOut.slice(0, 30).map(o => linkRow(o.id, o.text, o.color)).join("")}</div></div>`);
  if (info?.defined?.length) parts.push(`<div><h3>Defined in a dictionary</h3><div class="list">${info.defined.slice(0, 20).map(t => `<div class="it">${esc(t)}</div>`).join("")}</div></div>`);
  if (info?.broken?.length) parts.push(`<div><h3>Broken references</h3><div class="list">${info.broken.slice(0, 20).map(t => `<div class="it" style="color:var(--danger)">${esc(t)}</div>`).join("")}</div></div>`);
  if (info?.linksIn?.length) parts.push(`<div><h3>Pointed at by</h3><div class="list">${info.linksIn.slice(0, 30).map(o => linkRow(o.id, o.text, o.color)).join("")}</div></div>`);
  if (info?.tag) parts.push(`<div class="ren">${renameForm(info.tag, "renameSide")}</div>`);
  const acts = [];
  if (b.type === "group") acts.push(`<button class="btn primary" type="button" data-act="spread">Spread them out</button>`);
  else if (canToggle(b)) acts.push(`<button class="btn primary" type="button" data-act="toggle">${b.isOpen ? "Fold its child elements" : "Show its child elements"}</button>`);
  acts.push(`<button class="btn" type="button" data-act="close">Close</button>`);
  parts.push(`<div class="acts">${acts.join("")}</div>`);
  side.innerHTML = parts.join(""); side.hidden = false; side.dataset.id = b.id;
}
$("side").addEventListener("click", e => {
  const t = e.target.closest("button"); if (!t) return;
  const b = A.O.bodies.get($("side").dataset.id);
  if (t.dataset.sel) { const n = A.O.bodies.get(t.dataset.sel); if (n) { select(n); followBody(n, false); canvas.focus({ preventScroll:true }); } }
  else if (t.dataset.find) reveal(t.dataset.find);
  else if (t.dataset.act === "close") select(null);
  else if (t.dataset.act === "dict") $("dictIn").click();
  else if (b && t.dataset.act === "toggle") toggleOpen(b);
  else if (b && t.dataset.act === "spread") clickBody(b);
});

/* ---------------- find ---------------- */
function reveal(id){
  A.O.reveal(A.src.pathTo(id)); A.O.build();
  const b = A.O.bodies.get(id);
  if (!b) { note("That element is not in this file."); kick(); return; }
  select(b); followBody(b, true); A.pulse = { id:b.id, t0:performance.now() };
  if (b.parent) A.followK = Math.min(MAX_ZOOM, Math.max(A.followK || A.cam.k, 8 / Math.max(1e-4, b.size)));
}
let resIdx = -1, qTimer = 0;
/* Typing searches after a short pause (longer in a big file), so fast typing does not search, and lay out the results,
   for every letter. Enter and the arrow keys use the results for everything typed so far. */
$("q").addEventListener("input", () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { qTimer = 0; if (document.activeElement === $("q")) showResults(); }, A.src && A.src.total > 20000 ? 150 : 50);
});
const searchNow = () => { if (qTimer) { clearTimeout(qTimer); qTimer = 0; showResults(); } };
const searchCancel = () => { clearTimeout(qTimer); qTimer = 0; };
$("q").addEventListener("focus", () => { if ($("q").value.trim()) showResults(); });
$("q").addEventListener("keydown", e => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") searchNow();
  const items = [...$("results").querySelectorAll("button[data-r]")];
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); resIdx = Math.max(0, Math.min(items.length - 1, resIdx + (e.key === "ArrowDown" ? 1 : -1))); items.forEach((x, i) => x.classList.toggle("on", i === resIdx)); items[resIdx]?.scrollIntoView({ block:"nearest" }); }
  else if (e.key === "Enter") { if ($("results").hidden || !$("q").value.trim()) return; const x = items[Math.max(0, resIdx)]; if (x) x.click(); }
  else if (e.key === "Escape") { searchCancel(); $("results").hidden = true; }
});
document.addEventListener("click", e => { if (!e.target.closest(".searchwrap")) { searchCancel(); $("results").hidden = true; } });
function showResults(){
  const box = $("results"), q = $("q").value;
  if (!A.src || !q.trim()) { box.hidden = true; box.innerHTML = ""; return; }
  const res = A.src.search(q); resIdx = -1;
  box.innerHTML = res.length ? res.map(r => `<div><button type="button" data-r="${esc(r.id)}"><span class="l">${esc(r.label)}</span><span class="s">${esc(r.sub)}</span>${r.d ? `<span class="d">${esc(clip(r.d, 90))}</span>` : ""}</button></div>`).join("") : `<div class="empty">Nothing matches “${esc(q)}”.</div>`;
  box.hidden = false;
}
$("results").addEventListener("click", e => {
  const r = e.target.closest("button[data-r]");
  if (r) reveal(r.dataset.r);
  $("results").hidden = true; $("q").blur();
});

/* ---------------- loading ---------------- */
function note(msg){ const t = $("tip"); t.classList.remove("wide"); t.innerHTML = `<b>${esc(msg)}</b>`; t.hidden = false; t.style.left = Math.max(8, W / 2 - 150) + "px"; t.style.top = ($("top").getBoundingClientRect().bottom + 10) + "px"; clearTimeout(note.t); note.t = setTimeout(hideTip, 3500); }
/* Bytes to text. Byte-order marks and UTF-16 come first; then valid UTF-8 wins even when the declaration
   says otherwise (files are often mislabelled); then the declared encoding, else Windows-1252. */
function decode(buf){
  const u = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  if (u[0] === 0xFF && u[1] === 0xFE) return new TextDecoder("utf-16le").decode(buf);
  if (u[0] === 0xFE && u[1] === 0xFF) return new TextDecoder("utf-16be").decode(buf);
  if (u[0] === 0x3C && u[1] === 0) return new TextDecoder("utf-16le").decode(buf);
  if (u[0] === 0 && u[1] === 0x3C) return new TextDecoder("utf-16be").decode(buf);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch {}
  const head = new TextDecoder("latin1").decode(new Uint8Array(buf.slice(0, 300)));
  const m = /encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head);
  try { return new TextDecoder(m ? m[1] : "windows-1252").decode(buf); } catch { return new TextDecoder("utf-8").decode(buf); }
}
function setSource(src){
  A.src = src; A.O = new XO.Orbits(src); A.O.mode = A.view; A.sel = null; A.hover = null; A.follow = null; A.followK = null;
  $("side").hidden = true; hideTip();
  /* a file starts as one circle, the root element named after the file; click it to centre it, click again to see its children */
  A.O.build();
  for (let i = 0; i < 90; i++) A.O.step(1 / 30, false);
  renderLegend(); renderNames();
  requestAnimationFrame(() => fit(false));
}
function parseXml(text){
  const doc = new DOMParser().parseFromString(text, "application/xml");
  /* the browser reports bad XML as an XHTML <parsererror> element; an element of that name in the file itself is fine */
  const perr = doc.getElementsByTagNameNS("http://www.w3.org/1999/xhtml", "parsererror")[0];
  if (perr || !doc.documentElement) throw new Error("This is not well-formed XML. " + ((perr?.querySelector("div") || perr)?.textContent || "").trim().slice(0, 200));
  return doc;
}
function loadText(text, name){
  const doc = parseXml(text);
  /* work everything out first, so a failure leaves the current map untouched */
  const src = XO.sources.xmlSource(doc, name);
  /* the dictionaries are about names, not this file: they stay open */
  src.setDictionaries(A.dicts.map(d => d.dict));
  A.doc = doc;
  $("rootLine").hidden = false; renderRootLine();
  const f = $("file"); f.hidden = false;
  f.className = "pill" + (name.startsWith("samples/") ? " warn" : "");
  f.textContent = name.startsWith("samples/") ? "Example: " + name.slice(8).replace(/_/g, " ").replace(/\.xml$/, "") : name;
  f.title = name;
  /* the top bar shows the file's own name beside the app's; the browser tab shows both */
  const h = $("docTitle"); h.textContent = src.title; h.title = src.title; document.title = src.title + " · XML Orbitree";
  $("welcome").hidden = true;
  setSource(src);
}
let loadSeq = 0;
/* reading a big file takes a while: if something else is opened meanwhile, this file and any error from it are dropped */
async function loadFile(file){
  A.userLoaded = true; const my = ++loadSeq;
  try { const buf = await file.arrayBuffer(); if (my !== loadSeq) return; loadText(decode(buf), file.name); }
  catch (err) { if (my === loadSeq) showErr("Could not open " + file.name + ": " + err.message); }
}
function showErr(msg){ if (A.src) note(msg); else { $("welcome").hidden = false; $("err").textContent = msg; $("err").hidden = false; } }
async function loadSample(url = SAMPLE){
  const my = ++loadSeq;
  try { const r = await fetch(url); if (!r.ok) throw new Error("HTTP " + r.status); const buf = await r.arrayBuffer(); if (A.userLoaded || my !== loadSeq) return; loadText(decode(buf), url); if (SAMPLE_DICTS[url]) await loadSampleDict(SAMPLE_DICTS[url], my); }
  catch (err) {
    if (my !== loadSeq) return;
    if (A.src) { note(location.protocol === "file:" ? "Examples need this folder served (start.bat on Windows, ./serve.sh on macOS or Linux). Open a file instead." : "Could not load the example: " + err.message); return; }
    { $("welcome").hidden = false; if (location.protocol === "file:") { $("err").textContent = "Opened straight from disk, the sample cannot load. Open a file instead, or serve this folder (start.bat on Windows, ./serve.sh on macOS or Linux)."; $("err").hidden = false; } } }
}

/* ---------------- dictionaries: files whose definitions explain the names in the open file ---------------- */
/* a parsed file becomes a dictionary; one already open under the same title is replaced */
function addDictionary(doc, name){
  const title = XO.sources.titleOf(doc, name), dict = XO.explain.dictionary(doc, title);
  if (!dict.count) { note(title + " defines no terms: nothing in it has a code or name with a definition."); return; }
  A.dicts = A.dicts.filter(d => d.title !== title); A.dicts.push({ title, dict });
  applyDicts();
  note(`Dictionary added: ${title} (${XO.explain.count(dict.count, "term")})`);
}
function applyDicts(){
  const p = $("dict"), names = A.dicts.map(d => d.title);
  p.hidden = !A.dicts.length; $("dictNames").textContent = "Dictionary: " + names.join(", ");
  p.title = A.dicts.map(d => `${d.title}: ${XO.explain.count(d.dict.count, "term")}`).join("\n") + (A.dicts.length > 1 ? "\nThe one opened last is asked first." : "");
  A.src?.setDictionaries(A.dicts.map(d => d.dict));
  refreshViews();
}
async function loadDictionaryFile(file){
  try { const buf = await file.arrayBuffer(); addDictionary(parseXml(decode(buf)), file.name); }
  catch (err) { showErr("Could not open " + file.name + " as a dictionary: " + err.message); }
}
/* the dictionary bundled with an example; nothing happens when it is already open or another file was opened meanwhile */
async function loadSampleDict(url, my){
  try {
    const r = await fetch(url); if (!r.ok) throw new Error("HTTP " + r.status);
    const doc = parseXml(decode(await r.arrayBuffer()));
    if (my !== loadSeq || A.dicts.some(d => d.title === XO.sources.titleOf(doc, url))) return;
    addDictionary(doc, url);
  } catch (err) { if (my === loadSeq) note("Could not load the example's dictionary: " + err.message); }
}
$("dictIn").addEventListener("change", e => { const f = e.target.files[0]; if (f) loadDictionaryFile(f); e.target.value = ""; });
$("dictOff").addEventListener("click", () => { A.dicts = []; applyDicts(); note("Dictionaries closed."); });
/* the side panel, tooltip and search results say what the names mean: drawn again when that changes */
function refreshViews(){
  if (!A.O) return;
  const s = A.O.bodies.get(A.sel); if (s) renderSide(s);
  const h = A.O.bodies.get(A.hover); if (h && !$("tip").hidden) { $("tip").innerHTML = tipHtml(h); placeTip(h); }
  if (!$("results").hidden) showResults();
  kick();
}

/* ---------------- legend ---------------- */
function renderLegend(){
  const src = A.src, out = [];
  const tree = A.view === "tree";
  out.push(`<h4>${tree ? "Line and body colour" : "Orbit, line and body colour"}: the element's tag</h4>`);
  const tags = [...src.palette].filter(([k]) => k.startsWith("t:"));
  for (const [, v] of tags.slice(0, 16)) out.push(`<div class="k"><b style="background:${v.color};color:${v.color}"></b>${esc(v.title)}<em>${v.count}</em></div>`);
  if (tags.length > 16) out.push(`<div class="k" style="color:var(--faint)">… and ${tags.length - 16} more tags</div>`);
  out.push(`<div class="k"><i style="background:repeating-linear-gradient(90deg,${colour("ref")} 0 5px,transparent 5px 9px)"></i>id reference (ref, href, idref…)</div>`);
  out.push(tree
    ? `<p>The root element is at the bottom. Click a circle to centre it; click it again to show all its child elements above it, each on a branch that curves upward; once more to fold them. A dashed circle with a number is a folded group: click it to spread it out. The buttons at the bottom right show every element at once, or fold them all back into one circle. Drag a body to pull it about; it drifts back to its place. Hover to light up the chain back to the root.</p>`
    : `<p>Click a circle to centre it; click it again to show all its child elements; once more to fold them. A dashed circle with a number is a folded group: click it to spread it out. The buttons at the bottom right show every orbit at once, or fold them all back into one circle. Drag a body to pull it about; it drifts back to its orbit. Hover to light up the chain back to the centre.</p>`);
  $("legendBody").innerHTML = out.join("");
}

/* ---------------- display names ---------------- */
const NAMES_KEY = "xml-viewer.names";
(function loadNames(){
  try {
    const v = JSON.parse(localStorage.getItem(NAMES_KEY) || "null");
    if (v && Array.isArray(v.hide)) XO.names.hide = [...new Set(v.hide.filter(p => typeof p === "string" && p.trim()).map(p => p.trim()))];
    if (v && v.custom) for (const [k, n] of Object.entries(v.custom)) if (typeof n === "string" && n.trim()) XO.names.custom.set(k, n.trim());
  } catch {}
})();
/* the explanations in the Display names box: shown unless the viewer hides them */
const INFO_KEY = "xml-viewer.namesInfo";
function setNamesInfo(on){
  document.body.classList.toggle("ninfo-off", !on);
  for (const b of document.querySelectorAll('button[data-nact="info"]')) { b.textContent = on ? "Hide info" : "Show info"; b.setAttribute("aria-pressed", on); }
  try { localStorage.setItem(INFO_KEY, on ? "on" : "off"); } catch {}
}
try { setNamesInfo(localStorage.getItem(INFO_KEY) !== "off"); } catch { setNamesInfo(true); }
function saveNames(){ try { localStorage.setItem(NAMES_KEY, JSON.stringify({ hide:XO.names.hide, custom:Object.fromEntries(XO.names.custom) })); } catch {} }
/* the tags of this file, root first */
function fileTags(){
  const tags = A.src ? [...A.src.palette.values()].filter(v => v.tag).map(v => v.tag) : [];
  if (A.doc) tags.unshift(A.doc.documentElement.nodeName);
  return [...new Set(tags)];
}
function renderRootLine(){
  if (!A.doc) return;
  const rt = A.doc.documentElement.nodeName, shown = XO.names.show(rt);
  $("rootTag").textContent = shown; $("rootLine").title = "Root element: " + shown + (shown !== rt ? " (in the file: " + rt + ")" : "");
}
function renderNames(){
  renderRootLine();
  renderHide();
  renderRename();
}
/* the hidden parts, each a chip with a × to show it again */
function renderHide(){
  const N = XO.names, tags = fileTags();
  $("hideParts").innerHTML = N.hide.map((p, i) => {
    const n = tags.filter(t => t.toLowerCase().includes(p.toLowerCase())).length;
    const t = A.doc ? `Hidden in ${n} tag${n === 1 ? "" : "s"} of this file` : "Hidden";
    return `<span class="hpart" title="${esc(t)}"><s>${esc(p)}</s><button type="button" data-unhide="${i}" aria-label="Show ${esc(p)} again" title="Show it again">×</button></span>`;
  }).join("") + (N.hide.length > 1 ? `<button class="link" type="button" data-unhide="all">Show all again</button>` : "");
  renderHidePreview();
}
/* a before → after line, using what is typed in the box too, so the effect shows before pressing Hide */
function renderHidePreview(){
  const N = XO.names, typed = N.parse($("hideIn").value), parts = [...N.hide, ...typed], tags = fileTags();
  const hit = t => parts.some(p => t.toLowerCase().includes(p.toLowerCase()));
  const t = typed.length ? tags.find(t => typed.some(p => t.toLowerCase().includes(p.toLowerCase()))) : tags.find(hit);
  const el = $("hidePreview");
  if (!t) { el.innerHTML = typed.length && A.doc ? `No name in this file has “${esc(typed.join(" "))}”.` : ""; el.title = ""; return; }
  const after = N.strip(t, parts);
  el.innerHTML = `${esc(t)} → <b>${esc(after)}</b>`; el.title = "Example from this file: " + t + " → " + after;
}
function addHidden(){
  const N = XO.names, inp = $("hideIn"), add = N.parse(inp.value).filter(p => !N.hide.some(h => h.toLowerCase() === p.toLowerCase()));
  inp.value = "";
  if (!add.length) { renderHidePreview(); return; }
  N.hide.push(...add);
  applyNames();
  inp.focus();
}
$("hideAdd").addEventListener("click", addHidden);
$("hideIn").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addHidden(); } });
$("hideIn").addEventListener("input", renderHidePreview);
$("hideParts").addEventListener("click", e => {
  const b = e.target.closest("button[data-unhide]"); if (!b) return;
  e.stopPropagation();
  const N = XO.names;
  if (b.dataset.unhide === "all") N.hide = []; else N.hide.splice(+b.dataset.unhide, 1);
  applyNames();
  $("hideIn").focus();
});
function selectedTag(){
  const b = A.sel && A.O?.bodies.get(A.sel);
  return b && b.type !== "group" ? A.src.tagOf(b.id) : "";
}
function renameForm(tag, inputId){
  const N = XO.names, n = A.src.palette.get("t:" + tag)?.count || 1, cur = N.custom.get(tag) || "", shown = N.show(tag);
  const isRoot = A.doc && tag === A.doc.documentElement.nodeName;
  const help = `Shown for every element with this tag${n > 1 ? " (" + n.toLocaleString() + " in this file)" : ""}. Leave empty to go back to the name with hidden parts taken out.${isRoot ? " The root's circle keeps the file's own name." : ""}`;
  return `<div class="lbl" title="${esc(shown !== tag ? "In the file: <" + tag + ">" : "")}">Rename <b>&lt;${esc(shown)}&gt;</b>${n > 1 ? ` · ${n.toLocaleString()}×` : ""}</div>
    <div class="row"><input id="${inputId}" data-tag="${esc(tag)}" type="text" value="${esc(cur)}" placeholder="${esc(N.strip(tag))}" title="${esc(help)}" aria-label="New display name for ${esc(shown)}" autocomplete="off"><button class="btn primary" type="button" data-nact="save">Save</button>${cur ? `<button class="btn" type="button" data-nact="reset" title="Back to the name with hidden parts taken out">Reset</button>` : ""}</div>
    <p class="ninfo">${shown !== tag ? `In the file: &lt;${esc(tag)}&gt;. ` : ""}${esc(help)}</p>`;
}
function renderRename(){
  const box = $("renameArea"), N = XO.names, tag = selectedTag();
  const reset = N.custom.size ? `<button class="link" type="button" data-nact="resetAll">Reset all custom names (${N.custom.size})</button>` : "";
  box.innerHTML = (tag ? renameForm(tag, "renameIn") : `<div class="lbl">Select an element to rename it.</div>`) + reset;
}
function applyNames(){
  saveNames(); XO.names.version++;
  if (!A.O) return;
  A.O.build();
  renderLegend(); renderNames();
  refreshViews();
}
/* the rename form lives in the Display names box and in the side panel; both work the same */
function onRename(e){
  const t = e.target.closest("button[data-nact]"); if (!t) return;
  e.stopPropagation();
  if (t.dataset.nact === "info") { setNamesInfo(document.body.classList.contains("ninfo-off")); return; }
  const box = t.closest(".ren, .box") || e.currentTarget, inp = box.querySelector("input[data-tag]"), tag = inp?.dataset.tag, N = XO.names;
  if (t.dataset.nact === "save" && tag) { const v = inp.value.trim(); if (v) N.custom.set(tag, v); else N.custom.delete(tag); }
  else if (t.dataset.nact === "reset" && tag) N.custom.delete(tag);
  else if (t.dataset.nact === "resetAll") N.custom.clear();
  else return;
  /* the form is drawn again; put the cursor back where it was */
  const back = inp && document.activeElement === inp ? inp.id : t.dataset.nact === "save" && inp ? inp.id : null;
  applyNames();
  if (back) $(back)?.focus();
}
function onRenameKey(e){ if (e.key === "Enter" && e.target.matches("input[data-tag]")) { e.preventDefault(); e.target.parentElement.querySelector('button[data-nact="save"]').click(); } }
$("namesBox").addEventListener("click", onRename, true);
$("side").addEventListener("click", onRename, true);
for (const id of ["renameArea", "side"]) $(id).addEventListener("keydown", onRenameKey);

/* ---------------- controls ---------------- */
const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/></svg>';
function setPlay(on){
  A.playing = on; const b = $("play"), t = on ? "Pause orbits" : "Play orbits";
  b.innerHTML = on ? ICON_PAUSE : ICON_PLAY; b.title = t + " (space)"; b.setAttribute("aria-label", t); b.setAttribute("aria-pressed", on); b.classList.toggle("on", on); kick();
}
$("zoomIn").addEventListener("click", () => zoomAt(W / 2, H / 2, 1.4));
$("zoomOut").addEventListener("click", () => zoomAt(W / 2, H / 2, 1 / 1.4));
$("qk").textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";
document.addEventListener("keydown", e => {
  if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !e.target.closest?.("input,textarea,select"))) { e.preventDefault(); $("q").focus(); $("q").select(); }
});
$("play").addEventListener("click", () => setPlay(!A.playing));
/* Show the file as orbits or as a tree. What is open and what is selected stay; the choice is kept in this browser.
   Nothing turns in the tree, so it has no pause button. */
function setView(view){
  A.view = view;
  try { localStorage.setItem(VIEW_KEY, view); } catch {}
  for (const b of $("views").querySelectorAll("button")) { const on = b.dataset.view === view; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); }
  $("play").hidden = view === "tree";
  $("ready").textContent = VIEWS[view];
  const all = view === "tree" ? "Show all branches" : "Show all orbits", fold = view === "tree" ? "Fold all branches" : "Fold all orbits";
  $("showAll").title = all + " (a)"; $("showAll").setAttribute("aria-label", all);
  $("foldAll").title = fold + " (c)"; $("foldAll").setAttribute("aria-label", fold);
  if (!A.O) return;
  A.O.setMode(view);
  renderLegend(); refreshViews();
  fit(true);
}
$("views").addEventListener("click", e => { const b = e.target.closest("button[data-view]"); if (b && b.dataset.view !== A.view) setView(b.dataset.view); canvas.focus({ preventScroll:true }); });
$("fit").addEventListener("click", () => fit(true));
$("showAll").addEventListener("click", showAll);
$("foldAll").addEventListener("click", foldAll);
/* after a click on one of these buttons the keys on the map go on working */
for (const b of $("ctrls").querySelectorAll("button")) b.addEventListener("click", () => canvas.focus({ preventScroll:true }));
for (const id of ["openBtn", "openBtn2"]) $(id).addEventListener("click", () => $("fileIn").click());
$("sampleBtn").addEventListener("click", () => { A.userLoaded = false; loadSample(); });
$("examples").addEventListener("change", e => { const u = e.target.value; e.target.value = ""; if (u) { A.userLoaded = false; loadSample(u); } });
$("fileIn").addEventListener("change", e => { const f = e.target.files[0]; if (f) loadFile(f); e.target.value = ""; });
for (const id of ["legend", "namesBox"]) $(id).addEventListener("toggle", () => { const s = A.O?.bodies.get(A.sel); if (s && s.parent) followBody(s, false); else fit(true); });
let dragDepth = 0;
window.addEventListener("dragenter", e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { dragDepth++; $("drop").hidden = false; } });
window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("drop").hidden = true; } });
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => { e.preventDefault(); dragDepth = 0; $("drop").hidden = true; const f = e.dataTransfer?.files?.[0]; if (f) loadFile(f); });
document.addEventListener("paste", e => {
  if (e.target.closest?.("input,textarea")) return;
  const t = e.clipboardData?.getData("text") || "";
  if (t.trim().startsWith("<")) { A.userLoaded = true; loadSeq++; try { loadText(t, "pasted XML"); } catch (err) { showErr(err.message); } }
});
window.addEventListener("resize", () => { resize(); });
/* text widths measured before the web fonts arrived are wrong; measure again once they are in */
document.fonts?.ready.then(() => { widths.clear(); kick(); });
/* a canvas the browser dropped (to save memory, say, while in the background) comes back blank: draw it again */
canvas.addEventListener("contextrestored", kick);
/* the header wraps to two rows on mid-size screens; everything placed under it follows its real height */
new ResizeObserver(() => document.documentElement.style.setProperty("--top", $("top").getBoundingClientRect().bottom + "px")).observe($("top"));
if (innerWidth < 1100) $("legend").open = false;
renderNames();
setView(A.view);
resize();
loadSample();
window.XO.app = A; A.loadText = loadText; A.reveal = reveal; A.clickBody = clickBody;
})();
