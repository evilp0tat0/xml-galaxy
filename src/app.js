/* XML Galaxy: drawing, camera and interaction. */
(function(){
"use strict";
const XO = window.XO, clip = XO.clip;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const SAMPLE = "samples/S-201_FC_OpenS100_draft.xml";

const canvas = $("sky"), ctx = canvas.getContext("2d");
const A = { doc:null, FC:null, fileName:"", mode:"tree", src:null, O:null, playing:!REDUCED,
  cam:{ x:0, y:0, k:1 }, camTo:null, follow:null, followK:null, hover:null, sel:null, ptr:null, pinch:null, userLoaded:false };

/* ---------------- colours ---------------- */
const colour = key => key === "miss" ? "#ef4444" : (A.src?.palette.get(key)?.color || "#6b7280");
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
  freeCache = null; kick();
}
/* the free part of the screen: below the top bar, left of the side panel.
   Measuring the panels makes the browser lay out the page, and the camera asks for this every frame while it
   follows a body, so the answer is kept until something it depends on changes. Showing or hiding a panel or
   opening the colour key is seen at once; new sizes or content (window, fonts, a wrapping top bar) clear it. */
let freeCache = null, freeKey = "", sliding = false;
function freeArea(){
  const tabs = $("modes"), side = $("side"), lg = $("legend"), key = `${W} ${H} ${tabs.hidden} ${side.hidden} ${lg.open}`;
  /* while the side panel slides in its box moves every frame, so measure it every frame, as before */
  if (freeCache && key === freeKey && !sliding) return freeCache;
  const top = (tabs.hidden ? $("top") : tabs).getBoundingClientRect().bottom + 8;
  const sr = side.hidden ? null : side.getBoundingClientRect();
  const right = sr && W > 760 ? sr.left - 56 : W - 56;
  const bottom = sr && W <= 760 ? sr.top - 8 : $("foot").getBoundingClientRect().top - 8;
  const left = lg.open && W > 1100 ? Math.min(lg.getBoundingClientRect().right + 8, W * 0.3) : 8;
  freeKey = key;
  return freeCache = { x0:left, y0:top, x1:right, y1:Math.max(top + 80, bottom) };
}
{
  const forget = () => { freeCache = null; }, side = $("side"), panels = [$("top"), $("modes"), $("legend")];
  if (window.ResizeObserver) { const ro = new ResizeObserver(forget); for (const el of [...panels, $("foot")]) ro.observe(el); }
  /* a size change is only reported after the next frame, so also forget as soon as their content changes */
  const mo = new MutationObserver(forget); for (const el of panels) mo.observe(el, { subtree:true, childList:true, characterData:true, attributes:true });
  side.addEventListener("animationstart", e => { if (e.target === side) sliding = true; });
  for (const t of ["animationend", "animationcancel"]) side.addEventListener(t, e => { if (e.target === side) { sliding = false; freeCache = null; } });
}

/* ---------------- frame loop ---------------- */
/* Physics runs every frame, but the canvas is only drawn again when the picture would change: after a kick()
   (any change of state), while the camera zooms, ghosts fade or a search pulse runs, or once anything drawn has
   moved a quarter of a canvas pixel. Text is placed to a quarter pixel anyway, so smaller steps barely show.
   At fit zoom a big file's bodies creep about 0.02 px a frame, so most frames are skipped; a small catalogue's
   still move about 0.1 px, so about every other one. When everything comes to rest the exact picture is drawn. */
let raf = 0, last = 0, dirty = true;
function kick(){ dirty = true; if (!raf) raf = requestAnimationFrame(frame); }
function frame(now){
  raf = 0;
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now;
  const spin = A.playing && !!A.O && !A.hover && !A.ptr?.dragging;   /* nothing to turn before a file is loaded */
  const moving = A.O ? A.O.step(dt, spin) : false;
  const camMoving = cameraStep();
  /* a pulse whose body has folded away shows nothing, so it need not keep the loop running */
  const pulsing = !!A.pulse && !!A.O?.bodies.has(A.pulse.id);
  const busy = spin || moving || camMoving || A.ptr?.dragging || pulsing;
  const d = moved();
  const drew = dirty || pulsing || d > 0.25 / DPR || (!busy && d > 0);
  if (drew) { dirty = false; draw(); remember(); }
  /* hover still notices a body drifting under a still mouse every frame; the tip moves with the picture */
  if (!A.ptr && A.mx != null && (camMoving || moving || spin)) { const h = hit(A.mx, A.my, A.mslop); if ((h?.id ?? null) !== A.hover) setHover(h); else if (drew && h && !$("tip").hidden) placeTip(h); }
  /* setHover above may already have asked for the next frame; asking twice would run two loops */
  if (busy) { if (!raf) raf = requestAnimationFrame(frame); } else last = 0;
}
/* What the canvas last showed, to tell whether a new frame would look any different. */
const seen = { pos:new Float64Array(0) };
function remember(){
  const O = A.O, c = A.cam, s = seen;
  Object.assign(s, { O, order:O?.order, links:O?.links, ghosts:O?.ghosts.length || 0, k:c.k, W, H, DPR, hover:A.hover, sel:A.sel });
  if (!O) return;
  const n = O.order.length; if (s.pos.length < 2 * n) s.pos = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) { const b = O.order[i]; s.pos[2 * i] = c.x + c.k * b.x; s.pos[2 * i + 1] = c.y + c.k * b.y; }
}
/* How far any body has moved on screen since then; Infinity when something else changed (a rebuild, a zoom,
   fading ghosts, hover or selection, the canvas size). Bodies off screen count too: their orbits and lines can cross it. */
function moved(){
  const O = A.O, c = A.cam, s = seen;
  if (O !== s.O || O?.order !== s.order || O?.links !== s.links || (O?.ghosts.length || 0) || s.ghosts || c.k !== s.k
    || W !== s.W || H !== s.H || DPR !== s.DPR || A.hover !== s.hover || A.sel !== s.sel) return Infinity;
  if (!O) return 0;
  let m = 0;
  for (let i = 0, n = O.order.length; i < n; i++) {
    const b = O.order[i];
    m = Math.max(m, Math.abs(c.x + c.k * b.x - s.pos[2 * i]), Math.abs(c.y + c.k * b.y - s.pos[2 * i + 1]));
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
function fit(animate = true){
  if (!A.O) return;
  A.follow = null; A.followK = null;
  const fa = freeArea(), R = A.O.extent() + 120;
  let k = Math.min(1.6, Math.min(fa.x1 - fa.x0, fa.y1 - fa.y0) / (2 * R));
  if (!isFinite(k) || k <= 0) k = 0.05;
  k = Math.max(0.002, k);
  const t = { x:(fa.x0 + fa.x1) / 2, y:(fa.y0 + fa.y1) / 2, k };
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
    const R = b.sysR ? (b.sysR + b.size) * 1.15 + 6 : b.size * 12;
    A.followK = Math.max(0.05, Math.min(1e5, Math.min(fa.x1 - fa.x0, fa.y1 - fa.y0) / (2 * R)));
  }
  kick();
}

/* ---------------- what is lit ---------------- */
function litSet(){
  const O = A.O; if (!O) return null;
  const d = O.bodies.get(A.hover) || O.bodies.get(A.sel);
  if (!d) return null;
  const nodes = new Set(), links = new Set(), rings = new Set(), chain = O.chainOf(d), onChain = new Set(chain.map(x => x.id));
  for (const x of chain) nodes.add(x.id);
  for (let i = 0; i < chain.length - 1; i++) { const r = chain[i + 1].ring; if (r) rings.add(r.id); }
  for (const r of d.rings) rings.add(r.id);
  for (const l of O.links) {
    const a = l.a.id, b = l.b.id;
    if ((l.kind === "spoke" && onChain.has(a) && onChain.has(b)) || a === d.id || b === d.id) { links.add(l.id); nodes.add(a); nodes.add(b); }
  }
  return { d, nodes, links, rings, onChain };
}

/* ---------------- drawing ---------------- */
const MONO = '500 11px "JetBrains Mono", "Fira Code", ui-monospace, Menlo, Consolas, monospace';
const MONO_S = '500 10.5px "JetBrains Mono", "Fira Code", ui-monospace, Menlo, Consolas, monospace';
const SUN = '600 13px "JetBrains Mono", "Fira Code", ui-monospace, Menlo, Consolas, monospace';
const widths = new Map();
function textW(t, font){ const k = font + "|" + t; let w = widths.get(k); if (w == null) { ctx.font = font; w = ctx.measureText(t).width; widths.set(k, w); if (widths.size > 6000) widths.clear(); } return w; }
/* text measured before the web fonts arrived has the stand-in font's width: measure again, and redraw */
document.fonts?.addEventListener?.("loadingdone", () => { widths.clear(); freeCache = null; kick(); });
/* a canvas the browser dropped (e.g. while in the background) comes back blank */
canvas.addEventListener("contextrestored", kick);

/* GitNexus look: flat discs on a near-black void, thin curved edges, one hairline orbit per body.
   With something lit, the rest shrinks and fades, and the lit body and its neighbours grow. */
function bodyScale(b, lit){
  if (!lit) return 1;
  if (b.id === lit.d.id) return 1.5;
  return lit.nodes.has(b.id) ? 1.15 : 0.6;
}
/* Links longer than the screen are stroked only where they cross it (see draw); a piece of a quadratic curve is itself one.
   crossings: the values of t where one coordinate of the curve p0, p1, p2 equals v (the caller keeps those in 0..1) */
function crossings(p0, p1, p2, v, out){
  const a = p0 - 2 * p1 + p2, b = 2 * (p1 - p0), c = p0 - v;
  if (Math.abs(a) <= 1e-12 * (Math.abs(b) + Math.abs(c))) { if (b) out.push(-c / b); return; }
  const d = b * b - 4 * a * c; if (d < 0) return;
  const q = -(b + (b < 0 ? -1 : 1) * Math.sqrt(d)) / 2;
  out.push(q / a); if (q) out.push(c / q);
}
/* the stretches [t0, t1] of a quadratic curve that lie inside the box L..R, T..B */
function spansInBox(x0, y0, x1, y1, x2, y2, L, T, R, B){
  const ts = [0, 1];
  crossings(x0, x1, x2, L, ts); crossings(x0, x1, x2, R, ts); crossings(y0, y1, y2, T, ts); crossings(y0, y1, y2, B, ts);
  const s = ts.filter(t => t >= 0 && t <= 1).sort((p, q) => p - q), out = [];
  for (let i = 1; i < s.length; i++) {
    if (s[i] <= s[i - 1]) continue;
    const t = (s[i - 1] + s[i]) / 2, u = 1 - t, x = u * u * x0 + 2 * u * t * x1 + t * t * x2, y = u * u * y0 + 2 * u * t * y1 + t * t * y2;
    if (x < L || x > R || y < T || y > B) continue;
    if (out.length && out[out.length - 1][1] === s[i - 1]) out[out.length - 1][1] = s[i]; else out.push([s[i - 1], s[i]]);
  }
  return out;
}
/* how far along a quadratic curve the point at t lies (exact), so a piece's dashes line up with the whole curve's */
function lengthTo(x0, y0, x1, y1, x2, y2, t){
  const ax = x1 - x0, ay = y1 - y0, bx = x0 - 2 * x1 + x2, by = y0 - 2 * y1 + y2;
  const a = bx * bx + by * by, b = ax * bx + ay * by, c = ax * ax + ay * ay;
  if (a <= 1e-12 * c) return 2 * Math.sqrt(c) * t;
  const p0 = b / a, m = Math.max(c / a - p0 * p0, 1e-300), sm = Math.sqrt(m), g = p => p * Math.sqrt(p * p + m) + m * Math.asinh(p / sm);
  return Math.sqrt(a) * (g(t + p0) - g(p0));
}
const NODASH = [], DASH_INH = [3, 4], DASH_X = [5, 5];
/* line style is set only when it changes: hundreds of rings and links mostly share a few styles */
function penFor(g){ let col, w, dash; return (c, lw, d) => { if (c !== col) g.strokeStyle = col = c; if (lw !== w) g.lineWidth = w = lw; if (d !== dash) g.setLineDash(dash = d); }; }
/* One body's orbits, centred at x, y: hairlines, each its own stroke (one path for many would paint their overlaps once
   instead of building them up). A ring is skipped when it misses the w × h canvas, or the whole canvas lies inside it. */
function strokeRings(g, pen, b, x, y, k, lit, w, h){
  const near = Math.hypot(x - Math.max(0, Math.min(w, x)), y - Math.max(0, Math.min(h, y))), far = Math.hypot(Math.max(x, w - x), Math.max(y, h - y));
  for (const ring of b.rings) {
    const rr = ring.r * k, on = lit?.rings.has(ring.id), lw = on ? 1.3 : 0.8;
    if (rr < 1.5 || near > rr + lw + 2 || far < rr - lw - 2) continue;
    g.globalAlpha = lit ? (on ? 0.55 : 0.04) : (b.depth === 0 ? 0.16 : 0.12);
    pen(colour(ring.color), lw, ring.grp.folded ? DASH_INH : NODASH);
    g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.stroke();
  }
}
/* A body with very many orbits (a spread-out group) has them drawn once into a picture of their own, reused while the zoom,
   the lit body and the orbits stay the same: one copy instead of hundreds of strokes. The centre is kept to a sixteenth of a
   pixel, far below what shows, so a slowly drifting planet reuses it too; moving a picture by whole pixels changes nothing.
   While the zoom changes from one frame to the next a picture would be thrown away at once, so draw() strokes the rings
   directly then (drawnK), and makes the picture once the zoom holds. */
const ringPics = new Map();
let picStamp = 0, drawnK = NaN;
function drawRingPicture(b, x, y, k, lit){
  const half = Math.ceil((b.rings[b.rings.length - 1].r * k + 3) * DPR) + 1, size = 2 * half;
  if (size > canvas.width || size > canvas.height) return false;
  const qx = Math.round(x * DPR * 16) / 16, qy = Math.round(y * DPR * 16) / 16, ix = Math.floor(qx), iy = Math.floor(qy);
  if (ix + half < 0 || iy + half < 0 || ix - half > canvas.width || iy - half > canvas.height) return true;
  const fx = qx - ix, fy = qy - iy, who = lit ? lit.d.id : null;
  let p = ringPics.get(b.id);
  if (!p || p.rings !== b.rings || p.k !== k || p.fx !== fx || p.fy !== fy || p.who !== who || p.size !== size || p.dpr !== DPR) {
    /* the same canvas is reused: resizing it frees the old pixels at once, rather than leaving them for the garbage collector */
    const cv = p?.cv ?? document.createElement("canvas");
    if (cv.width !== size || cv.height !== size) { cv.width = size; cv.height = size; }
    ringPics.set(b.id, p = { cv, rings:b.rings, k, fx, fy, who, size, dpr:DPR });
    const g = cv.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, size, size); g.setTransform(DPR, 0, 0, DPR, 0, 0);
    strokeRings(g, penFor(g), b, (half + fx) / DPR, (half + fy) / DPR, k, lit, size / DPR, size / DPR);
  }
  p.stamp = picStamp;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.drawImage(p.cv, ix - half, iy - half); ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  return true;
}
function draw(){
  const c = A.cam;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  /* the background gradients are the canvas's CSS background (index.html), painted once instead of every frame */
  ctx.clearRect(0, 0, W, H);
  const O = A.O; if (!O) return;
  const lit = litSet();

  /* everything is drawn in screen pixels, worked out here in full precision: the canvas's own transform
     loses precision at the very large zooms needed for deep moons */
  const k = c.k, X = b => c.x + k * b.x, Y = b => c.y + k * b.y;
  const onScreen = (x, y, r) => x + r > -40 && y + r > -40 && x - r < W + 40 && y - r < H + 40;
  const pen = penFor(ctx);
  /* orbits: hairlines, one per body */
  picStamp++;
  const zooming = k !== drawnK; drawnK = k;
  for (const b of O.order) {
    if (!b.rings.length) continue;
    const x = X(b), y = Y(b);
    if (b.rings.length >= 64 && !zooming && drawRingPicture(b, x, y, k, lit)) continue;
    strokeRings(ctx, pen, b, x, y, k, lit, W, H);
  }
  if (!zooming) for (const [id, p] of ringPics) if (p.stamp !== picStamp) ringPics.delete(id);
  /* edges: curved, like Sigma's curved edge program. The curve lies inside the triangle of its three points, so that box decides
     whether it can show. One longer than the screen (zoomed in) is stroked only where it crosses the screen,
     its dashes started where they fall on the whole curve, so none are made off-screen and none crawl */
  const long = W + H;
  let pOff = 0;
  for (const l of O.links) {
    const on = lit?.links.has(l.id), ax = X(l.a), ay = Y(l.a), bx = X(l.b), by = Y(l.b), dx = bx - ax, dy = by - ay;
    if (Math.hypot(dx, dy) < 1) continue;
    const bend = l.kind === "spoke" ? 0.1 : l.kind === "extra" ? 0.18 : 0.26, cx = (ax + bx) / 2 - dy * bend, cy = (ay + by) / 2 + dx * bend;
    const w = on ? 2.4 : l.kind === "spoke" ? 0.9 : 1.1, m = w + 8;
    if (Math.max(ax, bx, cx) < -m || Math.max(ay, by, cy) < -m || Math.min(ax, bx, cx) > W + m || Math.min(ay, by, cy) > H + m) continue;
    const dash = l.kind === "spoke" ? (l.inh ? DASH_INH : NODASH) : DASH_X;
    ctx.globalAlpha = lit ? (on ? 0.95 : 0.04) : (l.kind === "spoke" ? 0.32 : 0.45);
    pen(colour(l.color), w, dash);
    const poly = Math.hypot(cx - ax, cy - ay) + Math.hypot(bx - cx, by - cy);
    if (poly < long) {
      if (pOff) ctx.lineDashOffset = pOff = 0;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(cx, cy, bx, by); ctx.stroke();
      continue;
    }
    /* each piece starts and ends on a fixed grid along the curve (a few hundred pixels apart), so panning redraws the same
       piece moved, as it did the whole curve: the dash ends stay put instead of shifting by a fraction of a pixel */
    const step = 256 / poly, pieces = [];
    for (const [s0, s1] of spansInBox(ax, ay, cx, cy, bx, by, -m, -m, W + m, H + m)) {
      const t0 = Math.floor(s0 / step) * step, t1 = Math.min(1, Math.ceil(s1 / step) * step), last = pieces[pieces.length - 1];
      if (last && t0 <= last[1]) last[1] = t1; else pieces.push([t0, t1]);
    }
    for (const [t0, t1] of pieces) {
      const u = 1 - t0, f = t1 - t0, v = 1 - t1;
      const sx = u * u * ax + 2 * u * t0 * cx + t0 * t0 * bx, sy = u * u * ay + 2 * u * t0 * cy + t0 * t0 * by;
      const ex = v * v * ax + 2 * v * t1 * cx + t1 * t1 * bx, ey = v * v * ay + 2 * v * t1 * cy + t1 * t1 * by;
      const off = dash.length ? lengthTo(ax, ay, cx, cy, bx, by, t0) % (dash[0] + dash[1]) : 0;
      if (off !== pOff) ctx.lineDashOffset = pOff = off;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(sx + f * (u * (cx - ax) + t0 * (bx - cx)), sy + f * (u * (cy - ay) + t0 * (by - cy)), ex, ey); ctx.stroke();
    }
  }
  if (pOff) ctx.lineDashOffset = 0;
  ctx.setLineDash(NODASH);
  /* bodies that are folding away */
  for (const g of O.ghosts) { const x = X(g), y = Y(g), r = g.size * k * g.life; if (r < 0.3 || !onScreen(x, y, r)) continue; ctx.globalAlpha = Math.max(0, g.life) * 0.6 * (lit ? 0.2 : 1); ctx.fillStyle = colour(g.color); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
  /* bodies */
  for (const b of O.order) {
    const x = X(b), y = Y(b), r = Math.max(b.size * k * bodyScale(b, lit), 1.2);
    if (!onScreen(x, y, r * 3)) continue;
    const on = !lit || lit.nodes.has(b.id), col = colour(b.color);
    /* no glow when the body's own solid disc, drawn next, covers the whole screen (zoomed deep into it): it would be hidden */
    const covers = on && Math.hypot(Math.max(x, W - x), Math.max(y, H - y)) < r - 2;
    if (!covers && (b.depth === 0 || b.id === A.sel || (lit && b.id === lit.d.id))) {
      const gr = r * (b.depth === 0 ? 3.4 : 2.6);
      ctx.globalAlpha = on ? (b.depth === 0 ? 0.55 : 0.4) : 0.08;
      ctx.drawImage(glowSprite(col), x - gr, y - gr, gr * 2, gr * 2);
    }
    ctx.globalAlpha = on ? 1 : 0.22;
    if (b.type === "group") {
      ctx.fillStyle = "#101018"; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.setLineDash([3, 2.5]); ctx.stroke(); ctx.setLineDash([]);
    } else {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      if (b.abstract) { ctx.fillStyle = "#06060a"; ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, 7); ctx.fill(); }
    }
    if (b.isOpen && b.depth > 0 && r > 2) { ctx.globalAlpha = on ? 0.6 : 0.15; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r + 3.5, 0, 7); ctx.stroke(); }
    if (b.id === A.hover || b.id === A.sel) { ctx.globalAlpha = b.id === A.sel ? 0.9 : 0.5; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 4, 0, 7); ctx.stroke(); }
  }
  /* search hit: a cyan pulse */
  const P = A.pulse, pb = P && O.bodies.get(P.id);
  if (pb) {
    const t = (performance.now() - P.t0) / 1000;
    if (t > 2.4) A.pulse = null;
    else {
      const x = X(pb), y = Y(pb), r = Math.max(pb.size * k * bodyScale(pb, lit), 3);
      for (let i = 0; i < 2; i++) { const p = ((t * 1.25 + i * 0.5) % 1); ctx.globalAlpha = (1 - p) * 0.9; ctx.strokeStyle = CYAN; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 4 + p * 26, 0, 7); ctx.stroke(); }
    }
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawLabels(lit);
  /* the counts only change with a rebuild; writing text, even the same text, makes the page restyle and lay out */
  if (counted !== O.order) { counted = O.order; countLine = A.src ? `${O.order.filter(b => b.type !== "group").length} of ${A.src.total.toLocaleString()} ${A.src.mode === "tree" ? "elements" : "types"} shown · ${O.order.reduce((s, b) => s + b.rings.length, 0)} orbits` : ""; }
  setText("status", countLine);
  setText("zoomPct", A.src ? `zoom ${Math.round(c.k * 100)}%` : "");
}
let counted = null, countLine = "";
const shownText = {};
function setText(id, t){ if (shownText[id] !== t) { shownText[id] = t; $(id).textContent = t; } }
const S = (b) => [A.cam.x + A.cam.k * b.x, A.cam.y + A.cam.k * b.y];

/* Labels are placed most important first; one that would overlap a placed label tries other sides, then is skipped. */
function drawLabels(lit){
  const O = A.O, k = A.cam.k, placed = [];
  const free = r => { if (r.x < -50 || r.y < -20 || r.x > W + 50 || r.y > H + 20) return false; for (const p of placed) if (r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y) return false; return true; };
  const pill = (x, y, w, h, stroke, lw = 1) => { ctx.fillStyle = "#12121c"; ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.fill(); ctx.stroke(); };
  /* bodies' circles block labels too, so names never sit on top of a planet */
  for (const b of O.order) { const [x, y] = S(b), r = b.size * k * bodyScale(b, lit); if (r > 3) placed.push({ x:x - r, y:y - r, w:2 * r, h:2 * r }); }
  const cands = [];
  for (const b of O.order) {
    const on = lit?.nodes.has(b.id);
    if (lit && !on && b.depth > 0) continue;
    const r = b.size * k;
    if (!on && b.depth > 1 && r < 3.2) continue;
    const pri = lit && b.id === lit.d.id && b.depth ? -2e9 : b.depth === 0 ? -1e9 : (on ? 0 : 1e6) + (b.id === A.sel || b.id === A.hover ? 0 : 1e5) + b.depth * 1e3 - b.size;
    cands.push([pri, b]);
  }
  cands.sort((p, q) => p[0] - q[0]);
  /* the sun's name sits under it */
  ctx.textBaseline = "middle";
  for (const [, b] of cands) {
    const [x, y] = S(b), r = b.size * k * bodyScale(b, lit), hot = lit?.nodes.has(b.id), main = lit && b.id === lit.d.id;
    if (b.depth === 0) {
      const t = clip(b.label, 40), w = textW(t, SUN) + 18, h = 24;
      const rect = { x:x - w / 2, y:y + r + 8, w, h };
      if (!free(rect) && lit) continue;
      placed.push(rect); ctx.font = SUN; pill(rect.x, rect.y, w, h, colour(b.color), 2);
      ctx.fillStyle = "#f5f5f7"; ctx.textAlign = "center"; ctx.fillText(t, x, rect.y + h / 2 + 0.5); ctx.textAlign = "left";
      continue;
    }
    const t = b.type === "group" ? `${b.label} · ${b.count}` : clip(b.label, hot ? 52 : 30);
    const font = hot || b.depth <= 1 ? MONO : MONO_S, w = textW(t, font) + (hot ? 16 : 4), h = hot ? 21 : 15;
    /* the lit body's name sits in a pill above it, as GitNexus draws a hovered node; others go beside */
    const above = [x - w / 2, y - r - 8 - h], tries = main ? [above, [x - w / 2, y + r + 8]] : [[x + r + 6, y - h / 2], [x - r - 6 - w, y - h / 2], [x - w / 2, y + r + 4], [x - w / 2, y - r - 4 - h]];
    for (const [lx, ly] of tries) {
      const rect = { x:lx, y:ly, w, h };
      if (!free(rect) && !main) continue;
      placed.push(rect);
      ctx.font = font;
      if (hot) { pill(lx, ly, w, h, colour(b.color) + (main ? "" : "99"), main ? 2 : 1); ctx.fillStyle = "#f5f5f7"; ctx.fillText(t, lx + 8, ly + h / 2 + 0.5); }
      else { ctx.fillStyle = b.depth <= 1 ? "rgba(228,228,237,.9)" : "rgba(136,136,160,.9)"; ctx.fillText(t, lx + 2, ly + h / 2 + 0.5); }
      break;
    }
  }
  /* link labels on the lit chain, then orbit names */
  if (lit) for (const l of O.links) {
    if (!lit.links.has(l.id) || !l.short) continue;
    const big = lit.links.size > 10;
    if (big && !(l.kind === "spoke" && lit.onChain.has(l.a.id) && lit.onChain.has(l.b.id))) continue;
    const [ax, ay] = S(l.a), [bx, by] = S(l.b), mx = (ax + bx) / 2, my = (ay + by) / 2;
    const w = textW(l.short, MONO_S) + 10, h = 17;
    for (const [dx, dy] of [[0, 0], [0, -16], [0, 16], [0, -32], [0, 32], [w * 0.6, 0], [-w * 0.6, 0]]) {
      const rect = { x:mx - w / 2 + dx, y:my - h / 2 + dy, w, h };
      if (!free(rect)) continue;
      placed.push(rect); pill(rect.x, rect.y, w, h, colour(l.color) + "77");
      ctx.font = MONO_S; ctx.fillStyle = colour(l.color); ctx.fillText(l.short, rect.x + 5, rect.y + h / 2 + 0.5);
      break;
    }
  }
  /* each group of neighbouring orbits is named once, on its innermost orbit */
  for (const b of O.order) for (const ring of b.rings) {
    if (!ring.first || ring.grp.count < 2 && !ring.grp.folded || !(b.depth === 0 || lit?.rings.has(ring.id) || b.id === A.sel || (lit && b.id === lit.d.id))) continue;
    const [x, y] = S(b), rr = ring.r * k;
    if (rr < 40) continue;
    const g = ring.grp, t = `${g.title} · ${g.count}${g.folded ? " (folded)" : ""}`, w = textW(t, MONO_S) + 6;
    const rect = { x:x - w / 2, y:y - rr - 8, w, h:15 };
    if (!free(rect)) continue;
    placed.push(rect); ctx.globalAlpha = lit && !lit.rings.has(ring.id) ? 0.25 : 0.85;
    ctx.font = MONO_S; ctx.fillStyle = colour(ring.color); ctx.fillText(t, rect.x + 3, rect.y + 7.5); ctx.globalAlpha = 1;
  }
}

/* ---------------- hit test and pointer ---------------- */
function hit(sx, sy, slop = 4){
  const O = A.O; if (!O) return null;
  let best = null, bd = Infinity;
  for (const b of O.order) {
    const [x, y] = S(b), r = Math.max(b.size * A.cam.k, 6) + slop, d = Math.hypot(x - sx, y - sy);
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
    if (A.ptr?.dragging) A.ptr.body.dragging = false;
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
  setHover(hit(e.offsetX, e.offsetY, A.mslop), e);
});
function endPointer(e){
  pts.delete(e.pointerId);
  if (pts.size < 2) A.pinch = null;
  const P = A.ptr; if (!P || P.id !== e.pointerId) return;
  A.ptr = null; canvas.classList.remove("grabbing");
  if (P.dragging) { P.body.dragging = false; kick(); return; }
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
  const c = A.cam, k = Math.max(0.002, Math.min(1e5, c.k * f));
  A.camTo = null; A.followK = null;
  if (A.follow) { c.k = k; kick(); return; }
  c.x = sx - (sx - c.x) * (k / c.k); c.y = sy - (sy - c.y) * (k / c.k); c.k = k; kick();
}
canvas.addEventListener("keydown", e => {
  if (e.key === "Escape") select(null);
  else if (e.key === "f") fit(true);
  else if (e.key === " ") { e.preventDefault(); setPlay(!A.playing); }
  else if (e.key === "+" || e.key === "=") zoomAt(W / 2, H / 2, 1.25);
  else if (e.key === "-") zoomAt(W / 2, H / 2, 0.8);
  else if (e.key === "Enter" && A.sel) { const b = A.O.bodies.get(A.sel); if (b) clickBody(b); }
});

/* ---------------- hover, tooltip, selection ---------------- */
function setHover(b, e){
  const id = b ? b.id : null;
  canvas.classList.toggle("pointing", !!b);
  if (id === A.hover) return;
  A.hover = id; kick();
  if (!b) { hideTip(); return; }
  const tip = $("tip"); tip.innerHTML = tipHtml(b); tip.hidden = false; placeTip(b);
}
function hideTip(){ $("tip").hidden = true; }
function chainText(b){
  return A.O.chainOf(b).map((x, i) => (i ? `<span class="s">→ ${esc(hopText(x, 40))} →</span> ` : "") + `<b>${esc(clip(x.label, 34))}</b>`).join(" ");
}
/* how a body hangs off its parent: the kind of link (catalogue) or its tag (plain XML) */
function hopText(x, n){ return A.src.mode === "links" ? clip(x.via?.label || x.ring?.grp.title || "", n) : (x.type === "group" ? x.label : x.kind || ""); }
const hopColour = x => A.src.mode === "links" ? colour(x.ring?.color) : colour(x.color);
function tipHtml(b){
  const n = A.src.node(b.id), kind = b.type === "group" ? `${b.count} × ${esc(b.label)} (folded)` : esc(n?.kind || "");
  const act = b.type === "group" ? "Click to spread them into a full orbit" : b.parent && A.src.canOpen(b.id) ? (b.isOpen ? "Click to fold its orbits" : "Click to open its own orbits") : "";
  const cross = A.O.links.filter(l => l.kind !== "spoke" && (l.a === b || l.b === b)).length;
  return `<b>${esc(b.type === "group" ? b.label : b.label)}</b><span class="s">${kind}</span>${b.parent ? `<div class="c">${chainText(b)}</div>` : ""}${cross ? `<div class="c">${cross} more link${cross === 1 ? "" : "s"} (dashed)</div>` : ""}${act ? `<div class="c">${act}</div>` : ""}`;
}
/* Try spots all round the body; keep the one covering least of it, its lit neighbours and the panels. */
function placeTip(b){
  const tip = $("tip"), [sx, sy] = S(b), rr = b.size * A.cam.k + 6, w = tip.offsetWidth, h = tip.offsetHeight;
  const avoid = [{ x0:sx - rr, y0:sy - rr, x1:sx + rr, y1:sy + rr, wt:1000 }];
  for (const el of [$("top"), $("side"), $("legend"), $("modes"), $("ctrls"), $("foot")]) if (el && !el.hidden) { const r = el.getBoundingClientRect(); avoid.push({ x0:r.left, y0:r.top, x1:r.right, y1:r.bottom, wt:30 }); }
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
  let opened = false;
  if (b.parent && A.src.canOpen(b.id)) {
    if (O.open.has(b.id)) O.open.delete(b.id); else { O.open.add(b.id); opened = true; }
    O.build();
  }
  const nb = O.bodies.get(b.id);
  select(nb); followBody(nb, opened);
}
function rebuildAndKeep(){ A.O.build(); const s = A.O.bodies.get(A.sel); if (s) renderSide(s); else select(null); kick(); }

/* ---------------- side panel ---------------- */
function renderSide(b){
  const side = $("side"), info = b.type === "group" ? null : A.src.info(b.id), O = A.O;
  const chain = O.chainOf(b);
  const chainHtml = chain.map((x, i) => (i ? `<span class="hop"><span class="dot" style="background:${hopColour(x)}"></span>${esc(hopText(x, 44))} →</span>` : "")
    + (x === b ? `<span class="chip here">${esc(clip(x.label, 30))}</span>` : `<button type="button" class="chip" data-sel="${esc(x.id)}">${esc(clip(x.label, 30))}</button>`)).join(" ");
  const seenX = new Set();
  const cross = O.links.filter(l => { if (l.kind === "spoke" || (l.a !== b && l.b !== b)) return false; const k = (l.a === b ? l.b.id : l.a.id) + "|" + l.color; if (seenX.has(k)) return false; seenX.add(k); return true; });
  const parts = [];
  const col = colour(b.color);
  parts.push(`<div class="kind"><span class="dot" style="background:${col};box-shadow:0 0 8px ${col}"></span>${esc(b.type === "group" ? "Folded group" : info?.kind || "")}</div>`);
  parts.push(`<h2>${esc(b.type === "group" ? `${b.count} × ${b.label}` : info?.title || b.label)}</h2>`);
  if (info?.code) parts.push(`<div class="code">${esc(info.code)}</div>`);
  if (b.parent) parts.push(`<div class="box"><h3>Where it comes from</h3><div class="chain">${chainHtml}</div></div>`);
  if (info?.def) parts.push(`<p>${esc(info.def)}</p>`);
  if (info?.facts?.length) parts.push(`<div class="tags">${info.facts.map(f => `<span class="tag">${esc(f)}</span>`).join("")}</div>`);
  if (info?.attrs?.length) parts.push(`<div><h3>Attributes</h3><dl class="attrs">${info.attrs.slice(0, 40).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(clip(v, 200))}</dd>`).join("")}</dl></div>`);
  if (info?.orbits?.length) parts.push(`<div><h3>Its orbits</h3><div class="tags">${info.orbits.map(o => `<span class="tag" style="border-color:${colour(o.color)};color:${colour(o.color)}">${esc(o.title)} ${o.count}</span>`).join("")}</div></div>`);
  const linkRow = (id, text, c) => `<div class="it"><span class="dot" style="background:${colour(c)}"></span><button type="button" class="chip" data-find="${esc(id)}">${esc(clip(text, 48))}</button></div>`;
  if (info?.linksOut?.length) parts.push(`<div><h3>Points to</h3><div class="list">${info.linksOut.slice(0, 30).map(o => linkRow(o.id, o.text, o.color)).join("")}</div></div>`);
  if (info?.broken?.length) parts.push(`<div><h3>Broken references</h3><div class="list">${info.broken.slice(0, 20).map(t => `<div class="it" style="color:var(--danger)">${esc(t)}</div>`).join("")}</div></div>`);
  if (info?.linksIn?.length) parts.push(`<div><h3>Pointed at by</h3><div class="list">${info.linksIn.slice(0, 30).map(o => linkRow(o.id, o.text, o.color)).join("")}</div></div>`);
  if (cross.length && A.src.mode === "links") parts.push(`<div><h3>Also linked (dashed lines)</h3><div class="list">${cross.slice(0, 20).map(l => { const o = l.a === b ? l.b : l.a; return linkRow(o.id, (A.src.palette.get(l.color)?.title || "") + ": " + o.label, l.color); }).join("")}</div></div>`);
  const acts = [];
  if (b.type === "group") acts.push(`<button class="btn primary" type="button" data-act="spread">Spread into a full orbit</button>`);
  else if (b.parent && A.src.canOpen(b.id)) acts.push(`<button class="btn primary" type="button" data-act="toggle">${b.isOpen ? "Fold its orbits" : "Open its own orbits"}</button>`);
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
  else if (b && (t.dataset.act === "toggle" || t.dataset.act === "spread")) clickBody(b);
});

/* ---------------- find ---------------- */
function reveal(id){
  const path = A.src.pathTo(id);
  if (!path) { note(A.src.mode === "links" ? "That is not reachable as an orbit from this sun. Use “Make it the centre” to start from it." : "That element is not in this file."); return; }
  A.O.reveal(path); A.O.build();
  const b = A.O.bodies.get(id);
  if (!b) { note("It sits inside a body that is already on the map; look for the dashed line."); return; }
  select(b); followBody(b, true); A.pulse = { id:b.id, t0:performance.now() };
  if (b.parent) A.followK = Math.min(1e5, Math.max(A.followK || A.cam.k, 8 / Math.max(1e-4, b.size)));
}
let resIdx = -1;
$("q").addEventListener("input", () => showResults());
$("q").addEventListener("focus", () => { if ($("q").value.trim()) showResults(); });
$("q").addEventListener("keydown", e => {
  const items = [...$("results").querySelectorAll("button[data-r]")];
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); resIdx = Math.max(0, Math.min(items.length - 1, resIdx + (e.key === "ArrowDown" ? 1 : -1))); items.forEach((x, i) => x.classList.toggle("on", i === resIdx)); items[resIdx]?.scrollIntoView({ block:"nearest" }); }
  else if (e.key === "Enter") { if ($("results").hidden || !$("q").value.trim()) return; const x = items[Math.max(0, resIdx)]; if (x) x.click(); }
  else if (e.key === "Escape") { $("results").hidden = true; }
});
document.addEventListener("click", e => { if (!e.target.closest(".searchwrap")) $("results").hidden = true; });
function showResults(){
  const box = $("results"), q = $("q").value;
  if (!A.src || !q.trim()) { box.hidden = true; box.innerHTML = ""; return; }
  const res = A.src.search(q); resIdx = -1;
  box.innerHTML = res.length ? res.map(r => `<div><button type="button" data-r="${esc(r.id)}"><span class="l">${esc(r.label)}</span><span class="s">${esc(r.sub)}</span></button>${r.canCentre ? `<div class="row" style="padding:0 8px 4px"><button type="button" data-centre="${esc(r.id)}">Make it the centre</button></div>` : ""}</div>`).join("") : `<div class="empty">Nothing matches “${esc(q)}”.</div>`;
  box.hidden = false;
}
$("results").addEventListener("click", e => {
  const r = e.target.closest("button[data-r]"), c = e.target.closest("button[data-centre]");
  if (c) { setSource(XO.sources.catalogueSource(A.FC, c.dataset.centre, A.fileName)); }
  else if (r) reveal(r.dataset.r);
  $("results").hidden = true; $("q").blur();
});

/* ---------------- loading ---------------- */
function note(msg){ const t = $("tip"); t.innerHTML = `<b>${esc(msg)}</b>`; t.hidden = false; t.style.left = Math.max(8, W / 2 - 150) + "px"; t.style.top = ($("top").getBoundingClientRect().bottom + 10) + "px"; clearTimeout(note.t); note.t = setTimeout(hideTip, 3500); }
function bestStart(FC){
  const F = XO.fc;
  const score = it => (it.fbind?.length || 0) + (it.ibind?.length || 0) + it.incoming.length + it.subtypes.length + (it.attrs?.length || 0) / 4;
  const pool = FC.items.filter(i => i.kind === "ft" && !i.abstract);
  return F.keyOf((pool.length ? pool : FC.items).slice().sort((a, b) => score(b) - score(a))[0]);
}
function setSource(src){
  A.src = src; A.O = new XO.Orbits(src); A.sel = null; A.hover = null; A.follow = null; A.followK = null;
  $("side").hidden = true; hideTip();
  /* open the first few levels until there is a fair amount to look at */
  if (src.mode === "tree") {
    for (let guard = 0; guard < 60; guard++) {
      A.O.build();
      if (A.O.order.length > 40) break;
      const next = A.O.order.find(b => b.type !== "group" && !A.O.open.has(b.id) && src.canOpen(b.id) && b.depth < 2);
      if (!next) break;
      A.O.open.add(next.id);
    }
  }
  A.O.build();
  for (let i = 0; i < 90; i++) A.O.step(1 / 30, false);
  renderLegend();
  $("modeLinks").setAttribute("aria-pressed", src.mode === "links"); $("modeTree").setAttribute("aria-pressed", src.mode === "tree");
  $("q").placeholder = src.mode === "links" ? "Search types…" : "Search elements…";
  $("ready").textContent = src.mode === "links" ? "Catalogue · by meaning" : "XML tree";
  requestAnimationFrame(() => fit(false));
}
function loadText(text, name){
  const doc = new DOMParser().parseFromString(text, "application/xml");
  /* the browser reports bad XML as an XHTML <parsererror> element; an element of that name in the file itself is fine */
  const perr = doc.getElementsByTagNameNS("http://www.w3.org/1999/xhtml", "parsererror")[0];
  if (perr || !doc.documentElement) throw new Error("This is not well-formed XML. " + ((perr?.querySelector("div") || perr)?.textContent || "").trim().slice(0, 200));
  /* work everything out first, so a failure leaves the current map untouched */
  let FC = XO.fc.isCatalogue(doc) ? XO.fc.parseFC(doc, name) : null;
  if (FC && !FC.items.length) FC = null;
  const src = FC ? XO.sources.catalogueSource(FC, bestStart(FC), name) : XO.sources.xmlSource(doc, name);
  A.doc = doc; A.fileName = name; A.FC = FC;
  const isFC = !!FC;
  $("modes").hidden = !isFC;
  const f = $("file"); f.hidden = false;
  f.className = "pill" + (name.startsWith("samples/") ? " warn" : "");
  f.textContent = name.startsWith("samples/") ? "Example: " + name.slice(8).replace(/_/g, " ").replace(/\.xml$/, "") : name;
  f.title = name;
  $("welcome").hidden = true;
  setSource(src);
}
let loadSeq = 0;
async function loadFile(file){
  A.userLoaded = true; loadSeq++;
  try { const buf = await file.arrayBuffer(); loadText(XO.fc.decode(buf), file.name); }
  catch (err) { showErr("Could not open " + file.name + ": " + err.message); }
}
function showErr(msg){ if (A.src) note(msg); else { $("welcome").hidden = false; $("err").textContent = msg; $("err").hidden = false; } }
async function loadSample(url = SAMPLE){
  const my = ++loadSeq;
  try { const r = await fetch(url); if (!r.ok) throw new Error("HTTP " + r.status); const buf = await r.arrayBuffer(); if (A.userLoaded || my !== loadSeq) return; loadText(XO.fc.decode(buf), url); }
  catch (err) {
    if (my !== loadSeq) return;
    if (A.src) { note(location.protocol === "file:" ? "Examples need this folder served (./serve.sh). Open a file instead." : "Could not load the example: " + err.message); return; }
    { $("welcome").hidden = false; if (location.protocol === "file:") { $("err").textContent = "Opened straight from disk, the sample cannot load. Open a file instead, or serve this folder (./serve.sh)."; $("err").hidden = false; } } }
}

/* ---------------- legend ---------------- */
function renderLegend(){
  const src = A.src, out = [];
  if (src.mode === "links") {
    out.push(`<h4>Orbits and lines: how it links to the body it circles</h4>`);
    for (const [k, v] of src.palette) if (k.startsWith("c:")) out.push(`<div class="k"><i style="background:${v.color}"></i>${esc(v.title)}</div>`);
    out.push(`<h4>Bodies: what the item is</h4>`);
    for (const [k, v] of src.palette) if (k.startsWith("k:")) out.push(`<div class="k"><b style="background:${v.color};color:${v.color}"></b>${esc(v.title)}</div>`);
    out.push(`<div class="k"><i style="background:repeating-linear-gradient(90deg,#94a3b8 0 5px,transparent 5px 9px)"></i>Also linked to a body elsewhere</div>`);
  } else {
    out.push(`<h4>Orbit, line and body colour: the element's tag</h4>`);
    const tags = [...src.palette].filter(([k]) => k.startsWith("t:"));
    for (const [, v] of tags.slice(0, 16)) out.push(`<div class="k"><b style="background:${v.color};color:${v.color}"></b>${esc(v.title)}<em>${v.count}</em></div>`);
    if (tags.length > 16) out.push(`<div class="k" style="color:var(--faint)">… and ${tags.length - 16} more tags</div>`);
    out.push(`<div class="k"><i style="background:repeating-linear-gradient(90deg,#e2e8f0 0 5px,transparent 5px 9px)"></i>id reference (ref, href, idref…)</div>`);
  }
  out.push(`<p>Click a body to open its own orbits; click again to fold them. A dashed circle with a number is a folded group: click it to spread it out. Drag a body to pull it about; it drifts back to its orbit. Hover to light up the chain back to the centre.</p>`);
  $("legendBody").innerHTML = out.join("");
}

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
$("fit").addEventListener("click", () => fit(true));
$("foldAll").addEventListener("click", () => { if (!A.O) return; A.O.open = new Set([A.src.rootId]); A.O.spread.clear(); select(null); A.O.build(); setTimeout(() => fit(true), 250); kick(); });
$("modeLinks").addEventListener("click", () => { if (A.FC && A.src.mode !== "links") setSource(XO.sources.catalogueSource(A.FC, bestStart(A.FC), A.fileName)); });
$("modeTree").addEventListener("click", () => { if (A.doc && A.src.mode !== "tree") setSource(XO.sources.xmlSource(A.doc, A.fileName)); });
for (const id of ["openBtn", "openBtn2"]) $(id).addEventListener("click", () => $("fileIn").click());
$("sampleBtn").addEventListener("click", () => { A.userLoaded = false; loadSample(); });
$("examples").addEventListener("change", e => { const u = e.target.value; e.target.value = ""; if (u) { A.userLoaded = false; loadSample(u); } });
$("fileIn").addEventListener("change", e => { const f = e.target.files[0]; if (f) loadFile(f); e.target.value = ""; });
$("legend").addEventListener("toggle", () => { const s = A.O?.bodies.get(A.sel); if (s && s.parent) followBody(s, false); else fit(true); });
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
if (innerWidth < 1100) $("legend").open = false;
resize();
loadSample();
window.XO.app = A; A.loadText = loadText; A.reveal = reveal; A.clickBody = clickBody;
})();
