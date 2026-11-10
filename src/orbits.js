/* The orbit engine. Who orbits whom is fixed by the source and never changes;
   where a body is right now is physics: it springs toward its spot on its parent's orbit,
   can be dragged away, and drifts back when let go. Its moons follow it wherever it goes.
   Bodies keep their own size at every depth. Orbits sit closer together at each level down: the sun's are
   spaced widest, and the orbits around a moon are half as far apart as those around its planet, and so on.
   Every orbit still clears each body's whole system.
   The same bodies can be laid out as a tree instead (mode "tree"): the root at the bottom, and each open body's
   children above it, each on a branch of its own shape and length that leaves the body leaning outward and bends
   upward, and that rises at between 45° and 135° all the way along. */
(function(){
"use strict";
const XO = window.XO;
const LEVEL = 0.5;                       /* orbit gaps (and the speed reference) around a moon, relative to its planet's */
const unit = depth => Math.pow(LEVEL, Math.max(0, depth - 1));
const MAX_UNFOLDED = 48;                 /* more children than this and the biggest groups fold */
const BRANCH_GAP = 16;                   /* tree: the room kept on each side of a body, between it and the next branch */
const BRANCH_RISE = 60;                  /* tree: how far above a body its children sit, at least (plus both bodies' sizes) */
/* tree: a child sits at most 30° to either side of straight up from its parent, and no part of its branch leans more
   than 45° to either side */
const FAN = Math.PI / 6, LEAN = Math.PI / 4;
const WANDER = Math.PI / 36;             /* tree: how far a branch's first lean strays from the regular fan, at most (5°) */
const STRETCH = 0.25;                    /* tree: how much further than the arc a child can sit, as a share of its rise */
/* a number from 0 up to 1 that is always the same for the same text: what makes one branch differ from the next */
function chance(text){
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

class Orbits {
  constructor(src){
    this.src = src;
    this.mode = "orbit";                /* "orbit": children circle their parent; "tree": they branch upward from it */
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
    const tree = this.mode === "tree";
    for (let i = order.length - 1; i >= 0; i--) if (tree) this.layoutBranches(order[i]); else this.layoutNode(order[i]);
    /* tree: where each body comes to rest, the root at 0, 0 (parents come first in the order) */
    if (tree) for (const b of order) { const p = b.parent; b.tx = p ? p.tx + b.ox : 0; b.ty = p ? p.ty + b.oy : 0; }
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

  /* Branch places for one body in the tree, once its children's own branches are placed. Each child's whole subtree
     gets a column of its own, side by side, so no two branches can cross; the body sits under the middle of its
     children. They start on an arc around it, wide enough that the outermost are 30° off straight up; then each is
     moved straight up by an amount of its own, so the branches are of uneven length, as grown ones are. */
  layoutBranches(n){
    const kids = n.rings.map(r => r.members[0]), half = n.size + BRANCH_GAP;
    n.rings = [];
    if (!kids.length) { n.wl = n.wr = half; return; }
    let w = 0;
    for (const m of kids) { m.ox = w + m.wl; w += m.wl + m.wr; }
    const first = kids[0].ox, last = kids[kids.length - 1].ox, mid = (first + last) / 2;
    const big = kids.reduce((v, m) => Math.max(v, m.size), 0);
    const R = Math.max(n.size + big + BRANCH_RISE, (last - first) / 2 / Math.sin(FAN));
    for (const m of kids) { m.ring = null; m.ox -= mid; m.oy = -Math.sqrt(Math.max(0, R * R - m.ox * m.ox)); }
    /* Outward from the middle on each side. A child can rise only so far that the straight line to it still passes
       under its inner neighbour's body, with room to spare, all the way to the outer edge of that neighbour's column
       (reach: how far the column goes on that side): the neighbour's whole subtree is above its body. The branch bows
       below that line, and each line is less steep than the one inside it, so it clears every column nearer the
       middle too. */
    const rise = (side, reach) => {
      let inner = null;
      for (const m of side) {
        if (m.ox) {
          const most = inner ? (-inner.oy - inner.size - BRANCH_GAP) * Math.abs(m.ox) / (Math.abs(inner.ox) + reach(inner)) : Infinity;
          m.oy = -Math.max(-m.oy, Math.min(-m.oy * (1 + STRETCH * chance(m.id + "|rise")), most));
          inner = m;
        } else m.oy *= 1 + STRETCH * chance(m.id + "|rise");
      }
    };
    rise(kids.filter(m => m.ox >= 0), m => m.wr); rise(kids.filter(m => m.ox < 0).reverse(), m => m.wl);
    this.shapeBranches(n, kids);
    /* how far the subtree reaches to the left and right of this body, and how far its own children reach */
    n.wl = Math.max(half, mid); n.wr = Math.max(half, w - mid);
    n.sysR = kids.reduce((v, m) => Math.max(v, Math.hypot(m.ox, m.oy)), 0) + big;
  }
  /* The shape of the branch to each child of n: m.branch, read by Orbits.branchCurve. A branch leaves its parent leaning
     further out than the straight line to the child (half as far again off straight up, give or take a little, but
     always further out), then turns upward and comes to the child steeper than that line. The branch to a child
     straight above leans a little to one side and comes back. How long each of the two bends is, how much steeper the
     end is and the give or take are the branch's own, within limits that narrow as the children crowd together. First leans stay in the children's order, left to right, so the
     branches of one body do not cross; an only child's branch sways to the left and to the right at alternate levels. */
  shapeBranches(n, kids){
    const off = kids.map(m => Math.atan2(m.ox, -m.oy));     /* how far off straight up each child is; to the right is positive */
    kids.forEach((m, i) => {
      const gap = Math.min(i ? off[i] - off[i - 1] : Infinity, i < kids.length - 1 ? off[i + 1] - off[i] : Infinity);
      /* how much of its own a branch may have: all of it with room around it, less the closer its neighbours are,
         so that branches packed tightly together run side by side */
      const own = Math.min(1, 0.7 * gap / WANDER), vary = key => own * (2 * chance(m.id + key) - 1);
      const stray = kids.length === 1 ? (n.depth % 2 ? 1 : -1) * (0.6 + 0.4 * chance(m.id + "|lean")) : vary("|lean");
      const start = Math.max(-LEAN, Math.min(LEAN, 1.5 * off[i] + stray * (off[i] ? Math.min(WANDER, 0.45 * Math.abs(off[i])) : WANDER)));
      const lean = start - off[i], a = 0.32 + 0.06 * vary("|a"), b = 0.31 + 0.05 * vary("|b");
      /* the end turns the same way as the start leans, and never so much that the middle of the branch would tip outward */
      const most = Math.asin(Math.min(1, a * Math.sin(Math.abs(lean)) / b));
      const turn = Math.sign(lean) * Math.min(Math.abs(off[i]) * (0.45 + 0.15 * vary("|turn")) + Math.abs(lean) * 0.4, most);
      m.branch = { lean, turn, a, b };
    });
  }

  /* One physics step. Parents come first in `order`, so moons aim at where their planet actually is. */
  step(dt, spin){
    if (spin) this.t += dt;
    const f = 1 - Math.exp(-dt * 7), tree = this.mode === "tree";
    let moving = 0;
    for (const b of this.order) {
      if (!b.parent) { b.ax = 0; b.ay = 0; }
      else if (tree) { b.ax = b.parent.x + b.ox; b.ay = b.parent.y + b.oy; }
      else if (!b.ring) { b.ax = 0; b.ay = 0; }
      else {
        const R = b.ring; if (R.rd == null) R.rd = R.r;
        R.rd += (R.r - R.rd) * f; if (Math.abs(R.r - R.rd) < 1e-6 * R.r) R.rd = R.r; else moving = Math.max(moving, 1);
        const a = b.a0 + R.speed * this.t; b.ax = b.parent.x + Math.cos(a) * R.rd; b.ay = b.parent.y + Math.sin(a) * R.rd;
      }
      if (b.dragging) continue;
      /* bodies ride exactly on their orbit; only one let go after a drag drifts back to it.
         In the tree every body eases to its place, and stops exactly on it. */
      if (!b.free && !tree) { b.x = b.ax; b.y = b.ay; continue; }
      const dx = b.ax - b.x, dy = b.ay - b.y;
      b.x += dx * f; b.y += dy * f;
      const off = (Math.abs(dx) + Math.abs(dy)) / Math.max(0.05, b.size);
      if (off < 0.01) { b.free = false; if (tree) { b.x = b.ax; b.y = b.ay; } }
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
  /* Change between the orbit and the tree layout; what is open stays open. Going back to orbits, every body drifts
     to its orbit from where the tree left it. */
  setMode(mode){
    this.mode = mode;
    if (mode === "orbit") for (const b of this.order) b.free = true;
    this.build();
  }
  /* the box the map fills once everything has come to rest (the layout knows this up front): a square round the sun
     that holds every orbit at its full size, or the box round the tree */
  bounds(){
    if (this.mode === "tree") {
      const B = { x0:-120, y0:-120, x1:120, y1:120 };
      for (const b of this.order) { B.x0 = Math.min(B.x0, b.tx - b.size); B.x1 = Math.max(B.x1, b.tx + b.size); B.y0 = Math.min(B.y0, b.ty - b.size); B.y1 = Math.max(B.y1, b.ty + b.size); }
      return B;
    }
    let R = 120;
    if (this.root) R = Math.max(R, this.root.size + (this.root.sysR || 0));
    for (const b of this.order) { const v = Math.hypot(b.ax ?? b.x, b.ay ?? b.y) + b.size; if (isFinite(v)) R = Math.max(R, v); }
    return { x0:-R, y0:-R, x1:R, y1:R };
  }
}
/* The branch from a parent at ax, ay to its child, body b, at bx, by (y grows downward): two curves joined smoothly end to
   end. Returns their control points and the point where they join, [x1, y1, xm, ym, x2, y2], in an array that is used
   again on the next call. The shape turns with the line between the two, so it holds while bodies move. */
const curve = [0, 0, 0, 0, 0, 0];
Orbits.branchCurve = (b, ax, ay, bx, by) => {
  const s = b.branch, dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy), up = Math.atan2(dx, -dy), a1 = up + s.lean, a2 = up - s.turn;
  curve[0] = ax + s.a * len * Math.sin(a1); curve[1] = ay - s.a * len * Math.cos(a1);
  curve[4] = bx - s.b * len * Math.sin(a2); curve[5] = by + s.b * len * Math.cos(a2);
  curve[2] = (curve[0] + curve[4]) / 2; curve[3] = (curve[1] + curve[5]) / 2;
  return curve;
};
XO.Orbits = Orbits;
})();
