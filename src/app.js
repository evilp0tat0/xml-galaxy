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
  kick();
}
/* the free part of the screen: below the top bar, left of the side panel */
function freeArea(){
  const tabs = $("modes"), top = (tabs.hidden ? $("top") : tabs).getBoundingClientRect().bottom + 8;
  const side = $("side"), sr = side.hidden ? null : side.getBoundingClientRect();
  const right = sr && W > 760 ? sr.left - 56 : W - 56;
  const bottom = sr && W <= 760 ? sr.top - 8 : $("foot").getBoundingClientRect().top - 8;
  const lg = $("legend"), left = lg.open && W > 1100 ? Math.min(lg.getBoundingClientRect().right + 8, W * 0.3) : 8;
  return { x0:left, y0:top, x1:right, y1:Math.max(top + 80, bottom) };
}

/* ---------------- frame loop ---------------- */
let raf = 0, last = 0;
function kick(){ if (!raf) raf = requestAnimationFrame(frame); }
function frame(now){
  raf = 0;
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now;
  const spin = A.playing && !A.hover && !A.ptr?.dragging;
  const moving = A.O ? A.O.step(dt, spin) : false;
  const camMoving = cameraStep();
  draw();
  if (!A.ptr && A.mx != null && (camMoving || moving || spin)) { const h = hit(A.mx, A.my, A.mslop); if ((h?.id ?? null) !== A.hover) setHover(h); else if (h && !$("tip").hidden) placeTip(h); }
  if (spin || moving || camMoving || A.ptr?.dragging || A.pulse) raf = requestAnimationFrame(frame); else last = 0;
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
/* worked out once per hover, selection and rebuild, not every frame */
let litMemo = { key:null, O:null, val:null };
function litSet(){
  const O = A.O; if (!O) return null;
  const d = O.bodies.get(A.hover) || O.bodies.get(A.sel);
  if (!d) return null;
  const key = d.id + "|" + O.version;
  if (litMemo.key === key && litMemo.O === O) return litMemo.val;
  litMemo = { key, O, val:litCompute(O, d) };
  return litMemo.val;
}
function litCompute(O, d){
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

/* ---------------- line batching and clipping ----------------
   Only the part of an orbit or link that crosses the screen is drawn. At deep zoom an orbit or link can be
   millions of pixels long, and stroking (worse, dashing) all of it every frame is what made big files crawl.
   Lines that look the same are drawn together, so the canvas's style is set once per look, not per line. */
const VIEW = { x0:0, y0:0, x1:0, y1:0 };
const outside = (x0, y0, x1, y1) => x1 < VIEW.x0 || y1 < VIEW.y0 || x0 > VIEW.x1 || y0 > VIEW.y1;
const DASH = { none:[], fold:[3, 4], inh:[3, 4], cross:[5, 5] };
const pens = new Map();
/* the batch for lines of one look; lines are queued as plain numbers and drawn at flush time */
function pen(color, alpha, width, dash){
  const key = color + "|" + alpha + "|" + width + "|" + dash;
  let s = pens.get(key);
  if (!s) pens.set(key, s = { color, alpha, width, dash, q:[] });
  return s;
}
const queueCurve = (s, x0, y0, cx, cy, x1, y1) => s.q.push(0, x0, y0, cx, cy, x1, y1);
const queueRing = (s, cx, cy, r) => s.q.push(1, cx, cy, r, 0, 0, 0);
/* Each line is still stroked on its own (one huge path with many crossings rasterises slower),
   but the look is set once per batch, and faint batches go first so lit lines always sit on top. */
const L = { p:ctx, lx:NaN, ly:NaN, used:false };
function flushPens(){
  for (const s of [...pens.values()].sort((a, b) => a.alpha - b.alpha || a.width - b.width)) {
    ctx.globalAlpha = s.alpha; ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.setLineDash(DASH[s.dash]);
    const q = s.q;
    for (let i = 0; i < q.length; i += 7) {
      L.lx = L.ly = NaN; L.used = false; ctx.beginPath();
      if (q[i] === 0) addCurve(L, q[i + 1], q[i + 2], q[i + 3], q[i + 4], q[i + 5], q[i + 6]);
      else addRing(L, q[i + 1], q[i + 2], q[i + 3]);
      if (L.used) ctx.stroke();
    }
  }
  pens.clear(); ctx.setLineDash(DASH.none);
}
/* carry on the current stroke when a piece starts where the last one ended, so dashes run on unbroken */
const startAt = (s, x, y) => { s.used = true; if (s.lx !== x || s.ly !== y) s.p.moveTo(x, y); };
/* a quadratic curve, split in half until each piece is short or off screen (a curve stays inside its control points) */
function addCurve(s, x0, y0, cx, cy, x1, y1, d = 0){
  if (outside(Math.min(x0, cx, x1), Math.min(y0, cy, y1), Math.max(x0, cx, x1), Math.max(y0, cy, y1))) return;
  if (d < 40 && Math.abs(cx - x0) + Math.abs(cy - y0) + Math.abs(x1 - cx) + Math.abs(y1 - cy) > 3000) {
    const ax = (x0 + cx) / 2, ay = (y0 + cy) / 2, bx = (cx + x1) / 2, by = (cy + y1) / 2, mx = (ax + bx) / 2, my = (ay + by) / 2;
    addCurve(s, x0, y0, ax, ay, mx, my, d + 1); addCurve(s, mx, my, bx, by, x1, y1, d + 1); return;
  }
  startAt(s, x0, y0); s.p.quadraticCurveTo(cx, cy, x1, y1); s.lx = x1; s.ly = y1;
}
/* a whole orbit: small ones as one circle, big ones only where they cross the screen */
function addRing(s, cx, cy, r){
  if (outside(cx - r, cy - r, cx + r, cy + r)) return;
  const fx = Math.max(Math.abs(VIEW.x0 - cx), Math.abs(VIEW.x1 - cx)), fy = Math.max(Math.abs(VIEW.y0 - cy), Math.abs(VIEW.y1 - cy));
  if (fx * fx + fy * fy < r * r) return;              /* the screen sits wholly inside it */
  if (r < 700) { s.used = true; s.p.moveTo(cx + r, cy); s.p.arc(cx, cy, r, 0, Math.PI * 2); s.lx = NaN; return; }
  for (let i = 0; i < 8; i++) addArc(s, cx, cy, r, i * Math.PI / 4, Math.PI / 4, 0);
}
function addArc(s, cx, cy, r, a, span, d){
  const x0 = cx + r * Math.cos(a), y0 = cy + r * Math.sin(a), x1 = cx + r * Math.cos(a + span), y1 = cy + r * Math.sin(a + span);
  const h = 2 * r * Math.sin(span / 4) ** 2;          /* how far the arc bulges past its chord */
  if (outside(Math.min(x0, x1) - h, Math.min(y0, y1) - h, Math.max(x0, x1) + h, Math.max(y0, y1) + h)) return;
  if (r * span > 400 && d < 48) { addArc(s, cx, cy, r, a, span / 2, d + 1); addArc(s, cx, cy, r, a + span / 2, span / 2, d + 1); return; }
  /* short enough that a quadratic through the tangents' meeting point is within a hair of the true arc;
     worked out here in full precision, so far-off centres never wobble */
  const m = a + span / 2, q = r / Math.cos(span / 2);
  startAt(s, x0, y0); s.p.quadraticCurveTo(cx + q * Math.cos(m), cy + q * Math.sin(m), x1, y1); s.lx = x1; s.ly = y1;
}

/* GitNexus look: flat discs on a near-black void, thin curved edges, one hairline orbit per body.
   With something lit, the rest shrinks and fades, and the lit body and its neighbours grow. */
function bodyScale(b, lit){
  if (!lit) return 1;
  if (b.id === lit.d.id) return 1.5;
  return lit.nodes.has(b.id) ? 1.15 : 0.6;
}
function draw(){
  const c = A.cam;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#06060a"); bg.addColorStop(1, "#0a0a10");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const vg = ctx.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.7);
  vg.addColorStop(0, "rgba(124,58,237,0.05)"); vg.addColorStop(1, "rgba(124,58,237,0)");
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  const O = A.O; if (!O) return;
  const lit = litSet();

  /* everything is drawn in screen pixels, worked out here in full precision: the canvas's own transform
     loses precision at the very large zooms needed for deep moons */
  const k = c.k, X = b => c.x + k * b.x, Y = b => c.y + k * b.y;
  const onScreen = (x, y, r) => x + r > -40 && y + r > -40 && x - r < W + 40 && y - r < H + 40;
  VIEW.x0 = -40; VIEW.y0 = -40; VIEW.x1 = W + 40; VIEW.y1 = H + 40;
  /* With many lines on the map, the unlit ones are drawn one screen pixel wide: browsers draw such
     hairlines (dashed ones above all) several times faster than anything thicker, and in a crowd
     the thinner lines read better anyway. Lit lines keep their full weight. */
  const crowded = O.links.length + O.ringCount > 500, hair = 1 / DPR;
  const thin = w => crowded ? Math.min(w, hair) : w;
  /* the same goes for lit lines when hundreds are lit at once (a sun with a thousand moons, say) */
  const manyLit = !!lit && lit.links.size + lit.rings.size > 300, litW = w => manyLit ? thin(1) : w;
  /* orbits: hairlines, one per body */
  for (const b of O.order) {
    if (!b.rings.length) continue;
    const x = X(b), y = Y(b), a = b.depth === 0 ? 0.16 : 0.12;
    let lastR = -Infinity;
    for (const ring of b.rings) {
      const rr = ring.r * k, on = lit?.rings.has(ring.id);
      /* orbits closer than two pixels on screen cannot be told apart: draw one of them (zoom in to see each);
         a lit orbit is always drawn, unless hundreds are lit at once */
      if (rr < 1.5 || (rr - lastR < 2 && !(on && !manyLit))) continue;
      lastR = rr;
      queueRing(pen(colour(ring.color), lit ? (on ? 0.55 : 0.04) : a, on ? litW(1.3) : thin(0.8), ring.grp.folded ? "fold" : "none"), x, y, rr);
    }
  }
  flushPens();
  /* edges: curved, like Sigma's curved edge program */
  for (const l of O.links) {
    const on = lit?.links.has(l.id), ax = X(l.a), ay = Y(l.a), bx = X(l.b), by = Y(l.b);
    const dx = bx - ax, dy = by - ay;
    if (Math.abs(dx) + Math.abs(dy) < 1) continue;
    const bend = l.kind === "spoke" ? 0.1 : l.kind === "extra" ? 0.18 : 0.26;
    const alpha = lit ? (on ? 0.95 : 0.04) : (l.kind === "spoke" ? 0.32 : 0.45);
    const dash = l.kind === "spoke" ? (l.inh ? "inh" : "none") : "cross";
    queueCurve(pen(colour(l.color), alpha, on ? litW(2.4) : thin(l.kind === "spoke" ? 0.9 : 1.1), dash), ax, ay, (ax + bx) / 2 - dy * bend, (ay + by) / 2 + dx * bend, bx, by);
  }
  flushPens();
  /* bodies that are folding away */
  for (const g of O.ghosts) { const x = X(g), y = Y(g), r = g.size * k * g.life; if (r < 0.3 || !onScreen(x, y, r)) continue; ctx.globalAlpha = Math.max(0, g.life) * 0.6 * (lit ? 0.2 : 1); ctx.fillStyle = colour(g.color); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
  /* bodies */
  for (const b of O.order) {
    const x = X(b), y = Y(b), r = Math.max(b.size * k * bodyScale(b, lit), 1.2);
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
  /* touching the page every frame would force a layout every frame */
  setText("status", A.src ? `${O.shown} of ${A.src.total.toLocaleString()} ${A.src.mode === "tree" ? "elements" : "types"} shown · ${O.ringCount} orbits` : "");
  setText("zoomPct", A.src ? `zoom ${Math.round(c.k * 100)}%` : "");
}
const shownText = new Map();
function setText(id, t){ if (shownText.get(id) !== t) { shownText.set(id, t); $(id).textContent = t; } }
const S = (b) => [A.cam.x + A.cam.k * b.x, A.cam.y + A.cam.k * b.y];

/* Labels are placed most important first; one that would overlap a placed label tries other sides, then is skipped. */
/* Placed labels are filed in a coarse screen grid, so each new label is checked only against its neighbours. */
const CELL = 64;
function labelGrid(){
  const cols = Math.ceil((W + 100) / CELL) + 1, rows = Math.ceil((H + 40) / CELL) + 1, cells = new Map();
  const span = r => [Math.max(0, Math.floor((r.x + 50) / CELL)), Math.max(0, Math.floor((r.y + 20) / CELL)),
    Math.min(cols - 1, Math.floor((r.x + r.w + 50) / CELL)), Math.min(rows - 1, Math.floor((r.y + r.h + 20) / CELL))];
  return {
    free(r){
      if (r.x < -50 || r.y < -20 || r.x > W + 50 || r.y > H + 20) return false;
      const [c0, r0, c1, r1] = span(r);
      for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
        const list = cells.get(cy * cols + cx); if (!list) continue;
        for (const p of list) if (r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y) return false;
      }
      return true;
    },
    add(r){
      if (r.x + r.w < -50 || r.y + r.h < -20 || r.x > W + 50 || r.y > H + 20) return;
      const [c0, r0, c1, r1] = span(r);
      for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) { const i = cy * cols + cx; const list = cells.get(i); if (list) list.push(r); else cells.set(i, [r]); }
    }
  };
}
function drawLabels(lit){
  const O = A.O, k = A.cam.k, grid = labelGrid(), free = r => grid.free(r);
  const pill = (x, y, w, h, stroke, lw = 1) => { ctx.fillStyle = "#12121c"; ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.fill(); ctx.stroke(); };
  /* bodies' circles block labels too, so names never sit on top of a planet */
  for (const b of O.order) { const [x, y] = S(b), r = b.size * k * bodyScale(b, lit); if (r > 3) grid.add({ x:x - r, y:y - r, w:2 * r, h:2 * r }); }
  /* a label sits at most a pill's width from its body; anything further off screen cannot be placed */
  const near = (x, y, r) => x + r + 420 > -50 && y + r + 60 > -20 && x - r - 420 < W + 50 && y - r - 60 < H + 20;
  const cands = [];
  for (const b of O.order) {
    const on = lit?.nodes.has(b.id);
    if (lit && !on && b.depth > 0) continue;
    const r = b.size * k;
    if (!on && b.depth > 1 && r < 3.2) continue;
    if (b.depth > 0) { const [x, y] = S(b); if (!near(x, y, r * 1.5)) continue; }
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
      grid.add(rect); ctx.font = SUN; pill(rect.x, rect.y, w, h, colour(b.color), 2);
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
      grid.add(rect);
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
      grid.add(rect); pill(rect.x, rect.y, w, h, colour(l.color) + "77");
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
    grid.add(rect); ctx.globalAlpha = lit && !lit.rings.has(ring.id) ? 0.25 : 0.85;
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
let qTimer = 0;
$("q").addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(showResults, A.src && A.src.total > 50000 ? 120 : 0); });
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
  setText("ready", src.mode === "links" ? "Catalogue · by meaning" : "XML tree");
  requestAnimationFrame(() => fit(false));
  warmSearch(src);
}
/* build the search index in idle moments, so the first search in a big file is instant */
const whenIdle = f => window.requestIdleCallback ? requestIdleCallback(f, { timeout:1000 }) : setTimeout(f, 40);
function warmSearch(src){
  if (!src.warm) return;
  const go = () => { if (A.src === src && !src.warm(8)) whenIdle(go); };
  whenIdle(go);
}
/* reading a big file blocks the page for a moment: say so first, and let the message paint */
async function busy(msg){
  setText("ready", msg); $("foot").classList.add("busy");
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
}
function idle(){ $("foot").classList.remove("busy"); if (A.src) setText("ready", A.src.mode === "links" ? "Catalogue · by meaning" : "XML tree"); }
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
  const my = loadSeq;
  await busy("Reading " + clip(file.name, 40) + (file.size > 1e6 ? " (" + (file.size / 1e6).toFixed(1) + " MB)" : "") + "…");
  try { const buf = await file.arrayBuffer(); if (my === loadSeq) loadText(XO.fc.decode(buf), file.name); }
  catch (err) { showErr("Could not open " + file.name + ": " + err.message); }
  finally { if (my === loadSeq) idle(); }
}
function showErr(msg){ if (A.src) note(msg); else { $("welcome").hidden = false; $("err").textContent = msg; $("err").hidden = false; } }
async function loadSample(url = SAMPLE){
  const my = ++loadSeq;
  try { const r = await fetch(url); if (!r.ok) throw new Error("HTTP " + r.status); const buf = await r.arrayBuffer(); if (A.userLoaded || my !== loadSeq) return;
    await busy("Reading the example…"); if (A.userLoaded || my !== loadSeq) return;
    try { loadText(XO.fc.decode(buf), url); } finally { idle(); } }
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
  if (t.trim().startsWith("<")) { A.userLoaded = true; const my = ++loadSeq; busy("Reading pasted XML…").then(() => { if (my !== loadSeq) return; try { loadText(t, "pasted XML"); } catch (err) { showErr(err.message); } finally { idle(); } }); }
});
window.addEventListener("resize", () => { resize(); });
if (innerWidth < 1100) $("legend").open = false;
resize();
loadSample();
window.XO.app = A; A.loadText = loadText; A.reveal = reveal; A.clickBody = clickBody;
})();
