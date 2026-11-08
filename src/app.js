/* Drawing, camera and interaction. */
(function(){
"use strict";
const XO = window.XO, clip = XO.clip;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const SAMPLE = "samples/S-201_FC_OpenS100_draft.xml";

const canvas = $("sky"), ctx = canvas.getContext("2d");
const A = { doc:null, src:null, O:null, playing:!REDUCED,
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
let raf = 0, last = 0;
function kick(){ if (!raf) raf = requestAnimationFrame(frame); }
function frame(now){
  raf = 0;
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now;
  const spin = !!A.O && A.playing && !A.hover && !A.ptr?.dragging;
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
    const R = b.sysR ? (b.sysR + b.size) * 1.15 + b.size * 0.5 : b.size * 12;
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
  /* orbits: hairlines, one per body */
  for (const b of O.order) for (const ring of b.rings) {
    const x = X(b), y = Y(b), rr = (ring.rd ?? ring.r) * k;
    if (rr < 1.5 || !onScreen(x, y, rr) || rr > 4 * Math.hypot(W, H) + Math.hypot(x - W / 2, y - H / 2)) continue;
    const on = lit?.rings.has(ring.id);
    ctx.globalAlpha = lit ? (on ? 0.3 : 0.025) : (b.depth === 0 ? 0.07 : 0.055);
    ctx.strokeStyle = colour(ring.color); ctx.lineWidth = on ? 1 : 0.6;
    ctx.setLineDash(ring.grp.folded ? [3, 4] : []);
    /* an open body's own orbit stops at the edge of its system, so the line never runs through its moons */
    const m = ring.members[0], mr = m.sysR ? (m.sysR + m.size) * k : 0, md = Math.hypot(X(m) - x, Y(m) - y);
    ctx.beginPath();
    if (mr > 2 && md > 0 && mr < 2 * rr) { const ma = Math.atan2(Y(m) - y, X(m) - x), hw = 2 * Math.asin(Math.min(1, mr / (2 * rr))); ctx.arc(x, y, rr, ma + hw, ma - hw + Math.PI * 2); }
    else if (!(mr > 2 && mr >= 2 * rr)) ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  /* edges: curved, like Sigma's curved edge program */
  for (const l of O.links) {
    const on = lit?.links.has(l.id), ax = X(l.a), ay = Y(l.a), bx = X(l.b), by = Y(l.b);
    if (Math.max(ax, bx) < -40 || Math.max(ay, by) < -40 || Math.min(ax, bx) > W + 40 || Math.min(ay, by) > H + 40) continue;
    if (Math.hypot(bx - ax, by - ay) < 1) continue;
    ctx.globalAlpha = lit ? (on ? 0.95 : 0.04) : (l.kind === "spoke" ? 0.32 : 0.45);
    ctx.strokeStyle = colour(l.color); ctx.lineWidth = on ? 2.4 : l.kind === "spoke" ? 0.9 : 1.1;
    ctx.setLineDash(l.kind === "spoke" ? [] : [5, 5]);
    const dx = bx - ax, dy = by - ay, bend = l.kind === "spoke" ? 0.1 : 0.26;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo((ax + bx) / 2 - dy * bend, (ay + by) / 2 + dx * bend, bx, by);
    ctx.stroke();
  }
  ctx.setLineDash([]);
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
      ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.setLineDash([3, 2.5]); ctx.stroke(); ctx.setLineDash([]);
      drawCount(n, x, y, r, "#f5f5f7");
    } else {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      /* how many direct child elements it has; nothing when it has none */
      drawCount(n, x, y, r, XO.sources.inkFor(col));
    }
    if (b.isOpen && b.depth > 0 && r > 2) { ctx.globalAlpha = on ? 0.6 : 0.15; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r + 3.5, 0, 7); ctx.stroke(); }
    if (b.id === A.hover || b.id === A.sel) { ctx.globalAlpha = b.id === A.sel ? 0.9 : 0.5; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 4, 0, 7); ctx.stroke(); }
  }
  /* search hit: a cyan pulse; it ends when its time is up or its body is folded away, or the frame loop would never stop */
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
  $("status").textContent = A.src ? `${O.order.filter(b => b.type !== "group").length} of ${A.src.total.toLocaleString()} elements shown · ${O.order.reduce((s, b) => s + b.rings.length, 0)} orbits` : "";
  $("zoomPct").textContent = A.src ? `zoom ${Math.round(c.k * 100)}%` : "";
}
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

/* Labels are placed most important first; one that would overlap a placed label tries other sides, then is skipped. */
function drawLabels(lit){
  const O = A.O, k = A.cam.k, placed = [];
  const free = r => { if (r.x < -50 || r.y < -20 || r.x > W + 50 || r.y > H + 20) return false; for (const p of placed) if (r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y) return false; return true; };
  const pill = (x, y, w, h, stroke, lw = 1) => { ctx.fillStyle = "#12121c"; ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.fill(); ctx.stroke(); };
  /* bodies' circles block labels too, so names never sit on top of a planet */
  for (const b of O.order) { const [x, y] = S(b), n = b.type === "group" ? b.count : b.kids || 0, r = Math.max(b.size * k * bodyScale(b, lit), n > 0 ? countR(n) : 0); if (r > 3) placed.push({ x:x - r, y:y - r, w:2 * r, h:2 * r }); }
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
    const cn = b.type === "group" ? b.count : b.kids || 0;
    const [x, y] = S(b), r = Math.max(b.size * k * bodyScale(b, lit), cn > 0 ? countR(cn) : 0), hot = lit?.nodes.has(b.id), main = lit && b.id === lit.d.id;
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
  setHover(hit(e.offsetX, e.offsetY, A.mslop), e);
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
  const act = b.type === "group" ? "Click to spread them into a full orbit" : A.sel !== b.id ? "Click to centre it" + (canToggle(b) ? "; click again to show its child elements" : "") : canToggle(b) ? (b.isOpen ? "Click again to fold its child elements" : "Click again to show its child elements") : "";
  const cross = A.O.links.filter(l => l.kind !== "spoke" && (l.a === b || l.b === b)).length;
  const head = !b.parent && A.src.header ? headerHtml(A.src.header()) : "";
  return `<b>${esc(b.label)}</b><span class="s">${kind}</span>${head}${b.parent ? `<div class="c">${chainText(b)}</div>` : ""}${cross ? `<div class="c">${cross} more link${cross === 1 ? "" : "s"} (dashed)</div>` : ""}${act ? `<div class="c">${act}</div>` : ""}`;
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
function rebuildAndKeep(){ A.O.build(); const s = A.O.bodies.get(A.sel); if (s) renderSide(s); else select(null); kick(); }

/* ---------------- side panel ---------------- */
function renderSide(b){
  const side = $("side"), info = b.type === "group" ? null : A.src.info(b.id), O = A.O;
  const chain = O.chainOf(b);
  const chainHtml = chain.map((x, i) => (i ? `<span class="hop"><span class="dot" style="background:${hopColour(x)}"></span>${esc(hopText(x))} →</span>` : "")
    + (x === b ? `<span class="chip here">${esc(clip(x.label, 30))}</span>` : `<button type="button" class="chip" data-sel="${esc(x.id)}">${esc(clip(x.label, 30))}</button>`)).join(" ");
  const parts = [];
  const col = colour(b.color);
  parts.push(`<div class="kind"><span class="dot" style="background:${col};box-shadow:0 0 8px ${col}"></span>${esc(b.type === "group" ? "Folded group" : info?.kind || "")}</div>`);
  parts.push(`<h2>${esc(b.type === "group" ? `${b.count} × ${b.label}` : info?.title || b.label)}</h2>`);
  if (info?.code) parts.push(`<div class="code">${esc(info.code)}</div>`);
  if (b.parent) parts.push(`<div class="box"><h3>Where it comes from</h3><div class="chain">${chainHtml}</div></div>`);
  if (info?.header?.length) parts.push(`<div class="box"><h3>About this file</h3>${headerHtml(info.header, 60, 40)}</div>`);
  if (info?.def) parts.push(`<p>${esc(info.def)}</p>`);
  if (info?.facts?.length) parts.push(`<div class="tags">${info.facts.map(f => `<span class="tag">${esc(f)}</span>`).join("")}</div>`);
  if (info?.attrs?.length) parts.push(`<div><h3>Attributes</h3><dl class="attrs">${info.attrs.slice(0, 40).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(clip(v, 200))}</dd>`).join("")}</dl></div>`);
  if (info?.orbits?.length) parts.push(`<div><h3>Its orbits</h3><div class="tags">${info.orbits.map(o => `<span class="tag" style="border-color:${colour(o.color)};color:${colour(o.color)}">${esc(o.title)} ${o.count}</span>`).join("")}</div></div>`);
  const linkRow = (id, text, c) => `<div class="it"><span class="dot" style="background:${colour(c)}"></span><button type="button" class="chip" data-find="${esc(id)}">${esc(clip(text, 48))}</button></div>`;
  if (info?.linksOut?.length) parts.push(`<div><h3>Points to</h3><div class="list">${info.linksOut.slice(0, 30).map(o => linkRow(o.id, o.text, o.color)).join("")}</div></div>`);
  if (info?.broken?.length) parts.push(`<div><h3>Broken references</h3><div class="list">${info.broken.slice(0, 20).map(t => `<div class="it" style="color:var(--danger)">${esc(t)}</div>`).join("")}</div></div>`);
  if (info?.linksIn?.length) parts.push(`<div><h3>Pointed at by</h3><div class="list">${info.linksIn.slice(0, 30).map(o => linkRow(o.id, o.text, o.color)).join("")}</div></div>`);
  if (info?.tag) parts.push(`<div class="ren">${renameForm(info.tag, "renameSide")}</div>`);
  const acts = [];
  if (b.type === "group") acts.push(`<button class="btn primary" type="button" data-act="spread">Spread into a full orbit</button>`);
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
  else if (b && t.dataset.act === "toggle") toggleOpen(b);
  else if (b && t.dataset.act === "spread") clickBody(b);
});

/* ---------------- find ---------------- */
function reveal(id){
  A.O.reveal(A.src.pathTo(id)); A.O.build();
  const b = A.O.bodies.get(id);
  if (!b) { note("That element is not in this file."); return; }
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
  box.innerHTML = res.length ? res.map(r => `<div><button type="button" data-r="${esc(r.id)}"><span class="l">${esc(r.label)}</span><span class="s">${esc(r.sub)}</span></button></div>`).join("") : `<div class="empty">Nothing matches “${esc(q)}”.</div>`;
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
  A.src = src; A.O = new XO.Orbits(src); A.sel = null; A.hover = null; A.follow = null; A.followK = null;
  $("side").hidden = true; hideTip();
  /* a plain XML file starts as one circle, the root element named after the file; click it to see its children */
  A.O.build();
  for (let i = 0; i < 90; i++) A.O.step(1 / 30, false);
  renderLegend(); renderNames();
  $("ready").textContent = "XML tree";
  requestAnimationFrame(() => fit(false));
}
function loadText(text, name){
  const doc = new DOMParser().parseFromString(text, "application/xml");
  /* the browser reports bad XML as an XHTML <parsererror> element; an element of that name in the file itself is fine */
  const perr = doc.getElementsByTagNameNS("http://www.w3.org/1999/xhtml", "parsererror")[0];
  if (perr || !doc.documentElement) throw new Error("This is not well-formed XML. " + ((perr?.querySelector("div") || perr)?.textContent || "").trim().slice(0, 200));
  /* work everything out first, so a failure leaves the current map untouched */
  const src = XO.sources.xmlSource(doc, name);
  A.doc = doc;
  $("rootLine").hidden = false; renderRootLine();
  const f = $("file"); f.hidden = false;
  f.className = "pill" + (name.startsWith("samples/") ? " warn" : "");
  f.textContent = name.startsWith("samples/") ? "Example: " + name.slice(8).replace(/_/g, " ").replace(/\.xml$/, "") : name;
  f.title = name;
  /* the heading and the browser tab carry the file's own name */
  const h = $("docTitle"); h.textContent = src.title; h.title = src.title; document.title = src.title;
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
  try { const r = await fetch(url); if (!r.ok) throw new Error("HTTP " + r.status); const buf = await r.arrayBuffer(); if (A.userLoaded || my !== loadSeq) return; loadText(decode(buf), url); }
  catch (err) {
    if (my !== loadSeq) return;
    if (A.src) { note(location.protocol === "file:" ? "Examples need this folder served (./serve.sh). Open a file instead." : "Could not load the example: " + err.message); return; }
    { $("welcome").hidden = false; if (location.protocol === "file:") { $("err").textContent = "Opened straight from disk, the sample cannot load. Open a file instead, or serve this folder (./serve.sh)."; $("err").hidden = false; } } }
}

/* ---------------- legend ---------------- */
function renderLegend(){
  const src = A.src, out = [];
  out.push(`<h4>Orbit, line and body colour: the element's tag</h4>`);
  const tags = [...src.palette].filter(([k]) => k.startsWith("t:"));
  for (const [, v] of tags.slice(0, 16)) out.push(`<div class="k"><b style="background:${v.color};color:${v.color}"></b>${esc(v.title)}<em>${v.count}</em></div>`);
  if (tags.length > 16) out.push(`<div class="k" style="color:var(--faint)">… and ${tags.length - 16} more tags</div>`);
  out.push(`<div class="k"><i style="background:repeating-linear-gradient(90deg,${colour("ref")} 0 5px,transparent 5px 9px)"></i>id reference (ref, href, idref…)</div>`);
  out.push(`<p>Click a circle to centre it; click it again to show all its child elements; once more to fold them. A dashed circle with a number is a folded group: click it to spread it out. Drag a body to pull it about; it drifts back to its orbit. Hover to light up the chain back to the centre.</p>`);
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
  const help = `Shown for every element with this tag${n > 1 ? " (" + n.toLocaleString() + " in this file)" : ""}. Leave empty to go back to the name with hidden parts taken out.${isRoot ? " The centre circle keeps the file's own name." : ""}`;
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
  saveNames();
  if (!A.O) return;
  A.O.build();
  renderLegend(); renderNames();
  const s = A.O.bodies.get(A.sel); if (s) renderSide(s);
  const h = A.O.bodies.get(A.hover); if (h && !$("tip").hidden) { $("tip").innerHTML = tipHtml(h); placeTip(h); }
  if (!$("results").hidden) showResults();
  kick();
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
for (const id of ["side"]) $(id).addEventListener("click", onRename, true);
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
$("fit").addEventListener("click", () => fit(true));
$("foldAll").addEventListener("click", () => { if (!A.O) return; A.O.open = new Set(); A.O.spread.clear(); select(null); A.O.build(); setTimeout(() => fit(true), 250); kick(); });
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
/* the header wraps to two rows on mid-size screens; everything placed under it follows its real height */
new ResizeObserver(() => document.documentElement.style.setProperty("--top", $("top").getBoundingClientRect().bottom + "px")).observe($("top"));
if (innerWidth < 1100) $("legend").open = false;
renderNames();
resize();
loadSample();
window.XO.app = A; A.loadText = loadText; A.reveal = reveal; A.clickBody = clickBody;
})();
