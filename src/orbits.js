/* The orbit engine. Who orbits whom is fixed by the source and never changes;
   where a body is right now is physics: it springs toward its spot on its parent's orbit,
   can be dragged away, and drifts back when let go. Its moons follow it wherever it goes.
   Bodies keep their own size at every depth. Orbits sit closer together at each level down: the sun's are
   spaced widest, and the orbits around a moon are half as far apart as those around its planet, and so on.
   Every orbit still clears each body's whole system. */
(function(){
"use strict";
const XO = window.XO;
const LEVEL = 0.5;                       /* orbit gaps (and the speed reference) around a moon, relative to its planet's */
const unit = depth => Math.pow(LEVEL, Math.max(0, depth - 1));
const MAX_UNFOLDED = 48;                 /* more children than this and the biggest groups fold */

class Orbits {
  constructor(src){
    this.src = src;
    /* bodies whose own orbits are shown; a file starts as one closed circle */
    this.open = new Set();
    this.spread = new Set();            /* folded groups the user has spread out */
    this.t = 0;
    this.bodies = new Map();            /* id → body; kept across rebuilds so positions carry over */
    this.order = []; this.links = []; this.ghosts = []; this.root = null;
  }
  collapseAt(depth){ return depth === 0 ? 16 : 10; }

  /* Breadth-first from the centre. Each element has one parent, so each gets one body;
     dashed lines come only from id references. Items hidden in a folded group count as placed. */
  build(){
    const src = this.src, prev = this.bodies, next = new Map(), claimed = new Map(), order = [], links = [];
    const mk = (id, base, extra) => {
      const old = prev.get(id);
      const b = Object.assign(old || { id, x:0, y:0, fresh:true }, base, extra, { rings:[], isOpen:false, sysR:0, dragging:old?.dragging || false });
      next.set(id, b); order.push(b); return b;
    };
    const rn = src.node(src.rootId);
    const root = mk(rn.id, rn, { type:"body", depth:0, parent:null });
    const q = [root];
    for (let qi = 0; qi < q.length; qi++) {    /* a read index, not shift(): shifting a long queue moves every item each time */
      const n = q[qi];
      if (n.type === "group" || !this.open.has(n.id) || !src.canOpen(n.id)) continue;
      n.isOpen = true;
      /* first pass: one plan per group of children */
      const plan = [];
      for (const g of src.groups(n.id)) if (g.entries.length) plan.push({ g, fresh:g.entries, gid:n.id + ">" + g.key, fold:false });
      /* fold big groups, and if there are still too many children, fold the biggest of the rest */
      for (const p of plan) p.fold = p.fresh.length > this.collapseAt(n.depth) && !this.spread.has(p.gid);
      let shown = plan.reduce((s, p) => s + (p.fold ? 1 : p.fresh.length), 0);
      for (const p of [...plan].sort((a, b) => b.fresh.length - a.fresh.length)) {
        if (shown <= MAX_UNFOLDED) break;
        if (p.fold || p.fresh.length < 2 || this.spread.has(p.gid)) continue;
        p.fold = true; shown -= p.fresh.length - 1;
      }
      for (const { g, fresh, gid, fold } of plan) {
        const members = [];
        if (fold) {
          const gb = mk(gid, { type:"group", label:g.title, color:g.color, size:10, count:fresh.length },
            { depth:n.depth + 1, parent:n });
          for (const f of fresh) claimed.set(f.id, gb);
          members.push(gb);
          links.push({ id:"s|" + gid, a:n, b:gb, color:g.color, kind:"spoke" });
        } else for (const e of fresh) {
          const nd = src.node(e.id); if (!nd) continue;
          const b = mk(e.id, nd, { type:"body", depth:n.depth + 1, parent:n });
          members.push(b); q.push(b);
          links.push({ id:"s|" + e.id, a:n, b, color:g.color, kind:"spoke" });
        }
        if (!members.length) continue;
        /* every body gets an orbit of its own; bodies from one group sit on neighbouring orbits */
        const grp = { title:g.title, count:members.reduce((s, m) => s + (m.count || 1), 0), folded:fold };
        members.forEach((m, j) => n.rings.push({ id:gid + "#" + j, grp, color:g.color, members:[m], first:j === 0 }));
      }
    }
    for (const r of order) for (const ref of src.refs(r.id)) {
      const t = next.get(ref.to) || claimed.get(ref.to);
      if (t && t !== r) links.push({ id:`r|${r.id}|${ref.to}`, a:r, b:t, color:ref.color, short:ref.short, kind:"cross" });
    }
    /* sizes first (children before parents: reverse breadth-first order), then swap in, so nothing half-built is ever drawn */
    for (let i = order.length - 1; i >= 0; i--) this.layoutNode(order[i]);
    for (const [id, b] of prev) if (!next.has(id)) this.ghosts.push({ x:b.x, y:b.y, size:b.size, color:b.color, to:b.parent && next.get(b.parent.id) || null, life:1 });
    if (this.ghosts.length > 400) this.ghosts.splice(0, this.ghosts.length - 400);
    for (const b of order) {
      const p = b.parent;
      if (b.fresh) { b.x = p ? p.x : 0; b.y = p ? p.y : 0; b.fresh = false; }
      /* a body already on the map keeps its place on its orbit, even if the orbit is now a different one */
      else if (p && b.ring && !b.free && !b.dragging) b.a0 = Math.atan2(b.y - p.y, b.x - p.x) - b.ring.speed * this.t;
    }
    /* orbits grow (or shrink) smoothly from where their body is now, so the whole map widens together
       and a newly spread system never cuts across its neighbours on the way */
    for (const b of order) for (const ring of b.rings) { const m = ring.members[0]; ring.rd = Math.hypot(m.x - b.x, m.y - b.y); }
    this.bodies = next; this.order = order; this.links = links; this.root = root;
    return this;
  }

  /* Orbit sizes for one body, once its moons' own systems are sized. One body per orbit, and each orbit
     clears the one inside it by both bodies' full systems, so no two bodies (or their moons) can ever collide. */
  layoutNode(n){
    const d = n.depth, u = unit(d + 1), ext = m => m.size + (m.sysR || 0);
    const pad = (d === 0 ? 9 : 5) * u, bandGap = (d === 0 ? 26 : 9) * u;
    let r = 0, prevExt = 0;
    n.rings.forEach((ring, i) => {
      const m = ring.members[0], e = ext(m);
      ring.r = i === 0 ? n.size + (d === 0 ? 46 : 14) * u + e : r + prevExt + pad + e + (ring.first ? bandGap : 0);
      /* inner orbits turn faster, so no two bodies keep step */
      ring.speed = d === 0 ? 0.08 * (110 / ring.r) : 0.22 * Math.pow(40 * u / ring.r, 0.8);
      m.ring = ring; m.a0 = i * 2.39996 + d * 1.3;
      r = ring.r; prevExt = e;
    });
    n.sysR = n.rings.length ? r + prevExt + (d ? 24 * u : 0) : 0;
  }

  /* One physics step. Parents come first in `order`, so moons aim at where their planet actually is. */
  step(dt, spin){
    if (spin) this.t += dt;
    const f = 1 - Math.exp(-dt * 7);
    let moving = 0;
    for (const b of this.order) {
      if (!b.parent || !b.ring) { b.ax = 0; b.ay = 0; }
      else {
        const R = b.ring; if (R.rd == null) R.rd = R.r;
        R.rd += (R.r - R.rd) * f; if (Math.abs(R.r - R.rd) < 1e-6 * R.r) R.rd = R.r; else moving = Math.max(moving, 1);
        const a = b.a0 + R.speed * this.t; b.ax = b.parent.x + Math.cos(a) * R.rd; b.ay = b.parent.y + Math.sin(a) * R.rd;
      }
      if (b.dragging) continue;
      /* bodies ride exactly on their orbit; only one let go after a drag drifts back to it */
      if (!b.free) { b.x = b.ax; b.y = b.ay; continue; }
      const dx = b.ax - b.x, dy = b.ay - b.y;
      b.x += dx * f; b.y += dy * f;
      const off = (Math.abs(dx) + Math.abs(dy)) / Math.max(0.05, b.size);
      if (off < 0.01) b.free = false;
      moving = Math.max(moving, off);
    }
    for (const g of this.ghosts) { g.life -= dt * 3; if (g.to) { g.x += (g.to.x - g.x) * f; g.y += (g.to.y - g.y) * f; } }
    this.ghosts = this.ghosts.filter(g => g.life > 0);
    return moving > 0.01 || this.ghosts.length > 0;
  }

  chainOf(b){ const c = []; for (let x = b; x; x = x.parent) c.unshift(x); return c; }

  /* Show every element: open every body that has children and spread every group, so nothing stays folded. */
  openAll(){
    const src = this.src, q = [src.rootId];
    for (let qi = 0; qi < q.length; qi++) {
      const id = q[qi];
      if (!src.canOpen(id)) continue;
      this.open.add(id);
      for (const g of src.groups(id)) { this.spread.add(id + ">" + g.key); for (const e of g.entries) q.push(e.id); }
    }
  }
  /* Open every body on the way (and spread any folded group that hides the next step). */
  reveal(path){
    for (let i = 0; i < path.length - 1; i++) {
      this.open.add(path[i]);
      for (const g of this.src.groups(path[i])) if (g.entries.some(e => e.id === path[i + 1])) this.spread.add(path[i] + ">" + g.key);
    }
  }
  /* how far the map reaches once every orbit has grown to its full size (the layout knows this up front) */
  extent(){
    let R = 120;
    if (this.root) R = Math.max(R, this.root.size + (this.root.sysR || 0));
    for (const b of this.order) { const v = Math.hypot(b.ax ?? b.x, b.ay ?? b.y) + b.size; if (isFinite(v)) R = Math.max(R, v); }
    return R;
  }
}
XO.Orbits = Orbits;
})();
