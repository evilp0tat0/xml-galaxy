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
const colour = key => key === "miss" ? "#f87171" : key === "ring" ? "#5b6b8c" : (A.src?.palette.get(key)?.color || "#94a3b8");
const glowCache = new Map();
function glowSprite(col){
  if (glowCache.has(col)) return glowCache.get(col);
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, col + "cc"); gr.addColorStop(0.35, col + "44"); gr.addColorStop(1, col + "00");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  glowCache.set(col, c); return c;
}
let stars = null;
function makeStars(){
  stars = document.createElement("canvas"); stars.width = stars.height = 512;
  const g = stars.getContext("2d");
  for (let i = 0; i < 160; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = Math.random() * 1.1 + 0.2;
    g.fillStyle = `rgba(200,215,255,${0.08 + Math.random() * 0.35})`; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
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
  const top = $("top").getBoundingClientRect().bottom + 8;
  const side = $("side"), sr = side.hidden ? null : side.getBoundingClientRect();
  const right = sr && W > 760 ? sr.left - 8 : W - 8;
  const bottom = sr && W <= 760 ? sr.top - 8 : H - 8;
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
  if (spin || moving || camMoving || A.ptr?.dragging) raf = requestAnimationFrame(frame); else last = 0;
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
    const R = ((b.sysR || 0) + b.size) * 1.15 + 6;
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
const MONO = '12px "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
const MONO_S = '11px "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
const SUN = '700 15px Inter, system-ui, sans-serif';
const widths = new Map();
function textW(t, font){ const k = font + "|" + t; let w = widths.get(k); if (w == null) { ctx.font = font; w = ctx.measureText(t).width; widths.set(k, w); if (widths.size > 6000) widths.clear(); } return w; }

function draw(){
  const c = A.cam;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const bg = ctx.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.45, Math.max(W, H) * 0.75);
  bg.addColorStop(0, "#0d1426"); bg.addColorStop(1, "#05070c");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  if (!stars) makeStars();
  const ox = ((c.x * 0.06) % 512 + 512) % 512, oy = ((c.y * 0.06) % 512 + 512) % 512;
  for (let x = -512 + ox; x < W; x += 512) for (let y = -512 + oy; y < H; y += 512) ctx.drawImage(stars, x, y);
  const O = A.O; if (!O) return;
  const lit = litSet(), dim = lit ? 0.13 : 1;

  /* everything is drawn in screen pixels, worked out here in full precision: the canvas's own transform
     loses precision at the very large zooms needed for deep moons */
  const k = c.k, X = b => c.x + k * b.x, Y = b => c.y + k * b.y;
  const onScreen = (x, y, r) => x + r > -40 && y + r > -40 && x - r < W + 40 && y - r < H + 40;
  /* orbits */
  for (const b of O.order) for (const ring of b.rings) {
    const x = X(b), y = Y(b), rr = ring.r * k;
    if (rr < 1.5 || !onScreen(x, y, rr) || rr > 4 * Math.hypot(W, H) + Math.hypot(x - W / 2, y - H / 2)) continue;
    const on = lit?.rings.has(ring.id);
    ctx.globalAlpha = lit ? (on ? 0.95 : 0.08) : (b.depth === 0 ? 0.5 : 0.38);
    ctx.strokeStyle = colour(ring.color); ctx.lineWidth = on ? 1.8 : 1.1;
    ctx.setLineDash([2, 6]);
    ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.setLineDash([]);
  /* links */
  for (const l of O.links) {
    const on = lit?.links.has(l.id), ax = X(l.a), ay = Y(l.a), bx = X(l.b), by = Y(l.b);
    if (Math.max(ax, bx) < -40 || Math.max(ay, by) < -40 || Math.min(ax, bx) > W + 40 || Math.min(ay, by) > H + 40) continue;
    if (Math.hypot(bx - ax, by - ay) < 1) continue;
    ctx.globalAlpha = lit ? (on ? 1 : 0.05) : (l.kind === "spoke" ? 0.42 : 0.3);
    ctx.strokeStyle = colour(l.color); ctx.lineWidth = on ? 2.2 : l.kind === "spoke" ? 1.1 : 1;
    ctx.beginPath();
    if (l.kind === "spoke") { ctx.setLineDash(l.inh ? [3, 4] : []); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
    else { ctx.setLineDash([5, 5]); const dx = bx - ax, dy = by - ay, bend = l.kind === "extra" ? 0.16 : 0.24; ctx.moveTo(ax, ay); ctx.quadraticCurveTo((ax + bx) / 2 - dy * bend, (ay + by) / 2 + dx * bend, bx, by); }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  /* bodies that are folding away */
  for (const g of O.ghosts) { const x = X(g), y = Y(g), r = g.size * k * g.life; if (r < 0.3 || !onScreen(x, y, r)) continue; ctx.globalAlpha = Math.max(0, g.life) * 0.7 * dim; ctx.fillStyle = colour(g.color); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
  /* bodies */
  for (const b of O.order) {
    const x = X(b), y = Y(b), r = Math.max(b.size * k, 1.2);
    if (!onScreen(x, y, r * 4.2)) continue;
    const on = !lit || lit.nodes.has(b.id), col = colour(b.color);
    ctx.globalAlpha = on ? 1 : dim;
    if (b.depth === 0 || (on && lit) || b.id === A.sel || (b.depth === 1 && r > 4)) {
      const gr = r * (b.depth === 0 ? 4.2 : 3.2);
      ctx.globalAlpha = on ? (b.depth === 0 ? 0.9 : 0.55) : 0.1;
      ctx.drawImage(glowSprite(col), x - gr, y - gr, gr * 2, gr * 2);
      ctx.globalAlpha = on ? 1 : dim;
    }
    if (b.type === "group") {
      ctx.fillStyle = "#0b1120"; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([3, 2.5]); ctx.stroke(); ctx.setLineDash([]);
    } else {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      if (b.abstract) { ctx.fillStyle = "#07090f"; ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, 7); ctx.fill(); }
      ctx.strokeStyle = "rgba(5,7,12,.85)"; ctx.lineWidth = 1.5; ctx.stroke();
    }
    if (b.isOpen && b.depth > 0) { ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(x, y, r + 6, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
    if (b.id === A.sel) { ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 9, 0, 7); ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawLabels(lit);
  $("status").textContent = A.src ? `${O.order.filter(b => b.type !== "group").length} of ${A.src.total.toLocaleString()} ${A.src.mode === "tree" ? "elements" : "types"} shown · zoom ${Math.round(c.k * 100)}%` : "";
}
const S = (b) => [A.cam.x + A.cam.k * b.x, A.cam.y + A.cam.k * b.y];

/* Labels are placed most important first; one that would overlap a placed label tries other sides, then is skipped. */
function drawLabels(lit){
  const O = A.O, k = A.cam.k, placed = [];
  const free = r => { if (r.x < -50 || r.y < -20 || r.x > W + 50 || r.y > H + 20) return false; for (const p of placed) if (r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y) return false; return true; };
  const pill = (x, y, w, h, stroke) => { ctx.fillStyle = "rgba(9,13,24,.92)"; ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill(); ctx.stroke(); };
  /* bodies' circles block labels too, so names never sit on top of a planet */
  for (const b of O.order) { const [x, y] = S(b), r = b.size * k; if (r > 3) placed.push({ x:x - r, y:y - r, w:2 * r, h:2 * r }); }
  const cands = [];
  for (const b of O.order) {
    const on = lit?.nodes.has(b.id);
    if (lit && !on && b.depth > 0) continue;
    const r = b.size * k;
    if (!on && b.depth > 1 && r < 3.2) continue;
    const pri = b.depth === 0 ? -1e9 : (on ? 0 : 1e6) + (b.id === A.sel || b.id === A.hover ? 0 : 1e5) + b.depth * 1e3 - b.size;
    cands.push([pri, b]);
  }
  cands.sort((p, q) => p[0] - q[0]);
  /* the sun's name sits under it */
  ctx.textBaseline = "middle";
  for (const [, b] of cands) {
    const [x, y] = S(b), r = b.size * k, hot = lit?.nodes.has(b.id);
    if (b.depth === 0) {
      const t = clip(b.label, 40), w = textW(t, SUN);
      const rect = { x:x - w / 2 - 4, y:y + r + 8, w:w + 8, h:20 };
      if (!free(rect) && lit) continue;
      placed.push(rect); ctx.font = SUN; ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.fillText(t, x, y + r + 18); ctx.textAlign = "left";
      continue;
    }
    const t = b.type === "group" ? `${b.label} · ${b.count}` : clip(b.label, hot ? 52 : 30);
    const font = hot || b.depth <= 1 ? MONO : MONO_S, w = textW(t, font) + (hot ? 12 : 4), h = hot ? 20 : 15;
    const tries = [[x + r + 6, y - h / 2], [x - r - 6 - w, y - h / 2], [x - w / 2, y + r + 4], [x - w / 2, y - r - 4 - h]];
    for (const [lx, ly] of tries) {
      const rect = { x:lx, y:ly, w, h };
      if (!free(rect)) continue;
      placed.push(rect);
      ctx.font = font;
      if (hot) { pill(lx, ly, w, h, colour(b.color) + "88"); ctx.fillStyle = "#f1f5f9"; ctx.fillText(t, lx + 6, ly + h / 2 + 0.5); }
      else { ctx.fillStyle = b.depth <= 1 ? "rgba(228,228,237,.92)" : "rgba(190,198,214,.8)"; ctx.fillText(t, lx + 2, ly + h / 2 + 0.5); }
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
      placed.push(rect); pill(rect.x, rect.y, w, h, colour(l.color) + "66");
      ctx.font = MONO_S; ctx.fillStyle = colour(l.color); ctx.fillText(l.short, rect.x + 5, rect.y + h / 2 + 0.5);
      break;
    }
  }
  for (const b of O.order) for (const ring of b.rings) {
    if (!(b.depth === 0 || lit?.rings.has(ring.id) || b.id === A.sel)) continue;
    const [x, y] = S(b), rr = ring.r * k;
    if (rr < 40) continue;
    const t = `${ring.title} · ${ring.count}${ring.folded ? " (folded)" : ""}`, w = textW(t, MONO_S) + 6;
    const rect = { x:x - w / 2, y:y - rr - 8, w, h:15 };
    if (!free(rect)) continue;
    placed.push(rect); ctx.globalAlpha = lit && !lit.rings.has(ring.id) ? 0.25 : 0.95;
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
function hopText(x, n){ return A.src.mode === "links" ? clip(x.via?.label || x.ring?.title || "", n) : (x.type === "group" ? x.label : x.kind || ""); }
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
  for (const el of [$("top"), $("side"), $("legend")]) if (el && !el.hidden) { const r = el.getBoundingClientRect(); avoid.push({ x0:r.left, y0:r.top, x1:r.right, y1:r.bottom, wt:30 }); }
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
  select(b); followBody(b, true);
  if (b.parent) A.followK = Math.min(1e5, Math.max(A.followK || A.cam.k, 14 / Math.max(1e-4, b.size)));
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
  $("q").placeholder = src.mode === "links" ? "Find a type and show how it links to the sun" : "Find an element and show where it sits";
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
function setPlay(on){ A.playing = on; $("play").textContent = on ? "Pause orbits" : "Play orbits"; $("play").setAttribute("aria-pressed", on); kick(); }
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
