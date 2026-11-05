/* Sources turn a parsed XML document into bodies and orbits.
   Both kinds answer the same questions, so the orbit engine and the drawing never care which one they have:
     node(id)      what a body is (label, colour key, size)
     groups(id)    what orbits it, one group per orbit
     refs(id)      extra links to bodies elsewhere (drawn dashed)
     info(id)      what the side panel shows
     search(q)     matching bodies
     pathTo(id)    chain of bodies from the centre to that one                          */
(function(){
"use strict";
const XO = window.XO = window.XO || {};
const clip = (t, n) => (t = String(t ?? "")).length > n ? t.slice(0, n - 1) + "…" : t;
XO.clip = clip;

/* Body colours in the GitNexus node palette (Tailwind 500s): distinct and readable on near-black. */
const PALETTE = ["#a855f7","#3b82f6","#10b981","#f59e0b","#ec4899","#14b8a6","#f97316","#6366f1","#eab308","#f43f5e","#06b6d4","#8b5cf6","#84cc16","#60a5fa","#fb7185","#a78bfa"];

/* ---------------- any XML: the root element is the sun, child elements orbit their parent ---------------- */
const KEY_ATTRS = ["name", "id", "code", "key", "title", "label", "type"];
const KEY_CHILDREN = new Set(["name", "code", "title", "label", "identifier"]);
const ID_ATTRS = new Set(["id", "ID", "Id", "xml:id"]);
const REF_ATTR = n => /^(ref|href|idref|idrefs|target|refid|xref)$/i.test(n) || /Ref$/.test(n) || /^ref[A-Z]/.test(n);

function xmlSource(doc, fileName){
  const E = [];              /* index → element record */
  const ids = new Map(), refAttrs = [], names = new Map();
  /* what an attribute's name alone tells us, worked out once per distinct name rather than once per attribute */
  const nameInfo = n => {
    let f = names.get(n); if (f) return f;
    const ln = n.slice(n.indexOf(":") + 1), pri = KEY_ATTRS.indexOf(n), named = ln === "id" || ln === "name", ref = REF_ATTR(ln), isId = ID_ATTRS.has(n) || ln === "id";
    names.set(n, f = { pri, named, ref, isId, link:ref && !ID_ATTRS.has(n), any:pri >= 0 || named || ref || isId });
    return f;
  };
  /* One pass over an element's attributes gives its key (if an attribute names it), its ids, and its references
     (resolved once every id is known). Names and values read as plain strings: el.attributes builds and keeps an object per attribute. */
  function attrKey(r){
    const el = r.el; let best = KEY_ATTRS.length, byKey = null, byId = null, byRef = null;
    for (const n of el.getAttributeNames()) {
      const f = nameInfo(n); if (!f.any) continue;
      const v = el.getAttribute(n);
      if (f.pri >= 0 && f.pri < best && v) { best = f.pri; byKey = v; }
      if (f.named && byId === null) byId = v;
      if (f.ref && byRef === null) byRef = v;
      if (f.isId) ids.set(v, r);
      if (f.link) refAttrs.push(r, n, v);
    }
    /* preference: a key attribute in KEY_ATTRS order, then the first id or name (even empty), then the first reference */
    return byKey ?? byId ?? (byRef === null ? null : "→ " + byRef.replace(/^#/, ""));
  }
  /* no telling attribute: a short child such as <name>, or a leaf's own text */
  function childKey(el){
    let c = el.firstElementChild;
    if (!c) return el.textContent.trim();
    for (; c; c = c.nextElementSibling) if (KEY_CHILDREN.has(c.localName) && !c.firstElementChild) { const v = c.textContent.trim(); if (v) return v; }
    return "";
  }
  /* a short human name for an element, and its label; those not settled by an attribute are worked out when first asked for */
  const keyOf = r => r.key ?? (r.key = childKey(r.el));
  const label = r => { const k = keyOf(r); return k ? r.tag + " · " + clip(k, 40) : r.tag; };
  /* one walk in document order, without a stack, so very deep files cannot overflow it; tags keep their prefix (a:item and b:item differ) */
  for (let el = doc.documentElement, up = null; el; ) {
    const r = { i:E.length, el, parent:up, depth:up ? up.depth + 1 : 0, tag:el.nodeName, kids:[], desc:0, key:null };
    E.push(r); if (up) up.kids.push(r);
    if (el.hasAttributes()) r.key = attrKey(r);
    const first = el.firstElementChild;
    if (first) { up = r; el = first; continue; }
    /* a leaf: on to its next sibling, or to the next sibling of the nearest ancestor that has one */
    while (!(el = el.nextElementSibling) && up) { el = up.el; up = up.parent; }
  }
  for (let i = E.length - 1; i > 0; i--) E[i].parent.desc += E[i].desc + 1;
  const id = r => "e" + r.i;
  const rec = idv => E[+String(idv).slice(1)];

  /* colour per tag, most common tags get the most distinct colours */
  const tagCount = new Map();
  for (const r of E) tagCount.set(r.tag, (tagCount.get(r.tag) || 0) + 1);
  const tags = [...tagCount.keys()].sort((a, b) => tagCount.get(b) - tagCount.get(a));
  const palette = new Map(tags.map((t, i) => ["t:" + t, { color:PALETTE[i % PALETTE.length], title:"<" + t + ">", count:tagCount.get(t) }]));
  palette.set("ref", { color:"#22d3ee", title:"Points to (id reference)" });

  /* id / idref links, in document order, now that every id is known */
  const out = new Map(), inn = new Map(), broken = new Map();
  for (let j = 0; j < refAttrs.length; j += 3) {
    const r = refAttrs[j], attr = refAttrs[j + 1];
    for (const raw of refAttrs[j + 2].split(/\s+/)) {
      const v = raw.replace(/^#/, ""), t = ids.get(v);
      if (!v || t === r) continue;
      if (!t) { (broken.get(r) || broken.set(r, []).get(r)).push({ attr, v }); continue; }
      (out.get(r) || out.set(r, []).get(r)).push({ to:t, attr });
      (inn.get(t) || inn.set(t, []).get(t)).push({ from:r, attr });
    }
  }
  /* only needed while the file is read; the functions below keep this scope alive as long as the file is shown */
  ids.clear(); names.clear(); refAttrs.length = 0;

  /* Search text: each element's tag, key and attribute values, lower-cased once and joined into one string per run of
     elements, so a keystroke is a quick scan of a few strings instead of a walk through the document. Runs are made when
     a search first reaches them: a query that matches early never pays for the rest of the file. XML can never contain
     the null character \0, so it safely separates the fields: no match can run from one field (or element) into the next,
     and lower-casing never looks across it, so an element's text lower-cased at once equals each field lower-cased alone.
     At most KEEP characters are kept this way: in a file of long texts or attributes (coordinate lists, path data) the
     elements past that are checked one by one, as they always were (matches). */
  const RUN = 1024, KEEP = 8e6, runs = [];
  let kept = 0;
  function run(k){
    const room = KEEP - kept; if (room <= 0) return null;
    const i0 = k * RUN, n = Math.min(E.length - i0, RUN), parts = new Array(n), at = new Int32Array(n + 1);
    let pos = 0;
    for (let j = 0; j < n; j++) {
      const r = E[i0 + j], el = r.el; let s = r.tag + "\0" + keyOf(r) + "\0";
      if (el.hasAttributes()) for (const nm of el.getAttributeNames()) { if (pos + s.length > room) break; s += el.getAttribute(nm) + "\0"; }
      if (pos + s.length > room) { kept = KEEP; return null; }
      s = s.toLowerCase(); parts[j] = s; at[j] = pos; pos += s.length;
    }
    at[n] = pos; kept += pos;
    return runs[k] = { i0, at, text:parts.join("") };
  }
  function matches(r, q){
    if (r.tag.toLowerCase().includes(q) || keyOf(r).toLowerCase().includes(q)) return true;
    const el = r.el;
    if (el.hasAttributes()) for (const nm of el.getAttributeNames()) if (el.getAttribute(nm).toLowerCase().includes(q)) return true;
    return false;
  }
  /* for xpath(): each element's place among its same-tag siblings, and how many there are; a parent can have thousands of children */
  let nth = null, same = null;

  const size = r => r.depth === 0 ? 26 : Math.min(17, 4.5 + 2.3 * Math.log2(1 + r.desc));
  return {
    mode:"tree", fileName, palette, total:E.length, rootId:id(E[0]),
    title:"<" + E[0].tag + ">",
    has: x => !!rec(x),
    node(x){ const r = rec(x); return r && { id:x, label:label(r), color:"t:" + r.tag, size:size(r), kind:"<" + r.tag + ">" }; },
    canOpen: x => { const r = rec(x); return !!r && r.kids.length > 0; },
    groups(x){
      const r = rec(x); if (!r) return [];
      const by = new Map();
      for (const k of r.kids) { if (!by.has(k.tag)) by.set(k.tag, []); by.get(k.tag).push(k); }
      return [...by].map(([tag, ks]) => ({ key:"t:" + tag, title:"<" + tag + ">", color:"t:" + tag,
        entries:ks.map(k => ({ id:id(k), short:"", label:"child <" + tag + ">" })) }));
    },
    refs(x){ const r = rec(x); return (out.get(r) || []).map(o => ({ to:id(o.to), color:"ref", short:"@" + o.attr, label:o.attr + " → " + label(o.to) })); },
    pathTo(x){ const c = []; for (let r = rec(x); r; r = r.parent) c.unshift(id(r)); return c; },
    search(q){
      q = q.trim().toLowerCase(); if (!q || q.includes("\0")) return [];
      const res = [];
      /* the first 40 matching elements in document order: find a match, look up its element, go on after that element */
      for (let k = 0; res.length < 40 && k * RUN < E.length; k++) {
        const R = runs[k] ?? run(k);
        if (!R) {
          for (let i = k * RUN, e = Math.min(E.length, i + RUN); i < e && res.length < 40; i++) if (matches(E[i], q)) res.push(E[i]);
          continue;
        }
        const { i0, at, text } = R;
        for (let p = text.indexOf(q); p >= 0 && res.length < 40; ) {
          let lo = 0, hi = at.length - 2;
          while (lo < hi) { const m = (lo + hi + 1) >> 1; if (at[m] <= p) lo = m; else hi = m - 1; }
          res.push(E[i0 + lo]); p = text.indexOf(q, at[lo + 1]);
        }
      }
      return res.map(r => ({ id:id(r), label:label(r), sub:xpath(r) }));
    },
    info(x){
      const r = rec(x); if (!r) return null;
      const direct = [...r.el.childNodes].filter(n => n.nodeType === 3 || n.nodeType === 4).map(n => n.nodeValue).join("").trim();
      const kidTags = new Map(); for (const k of r.kids) kidTags.set(k.tag, (kidTags.get(k.tag) || 0) + 1);
      return {
        kind:"Element <" + r.tag + ">" + (r.depth === 0 ? " · the centre" : ""), title:keyOf(r) || r.tag, code:xpath(r),
        def: direct ? clip(direct, 600) : "",
        attrs:[...r.el.attributes].map(a => [a.name, a.value]),
        facts:[r.desc ? r.desc + " elements inside" : "no child elements", r.el.namespaceURI ? "ns " + r.el.namespaceURI : ""].filter(Boolean),
        orbits:[...kidTags].map(([t, n]) => ({ color:"t:" + t, title:"<" + t + ">", count:n })),
        linksOut:(out.get(r) || []).map(o => ({ id:id(o.to), text:"@" + o.attr + " → " + label(o.to), color:"ref" })),
        linksIn:(inn.get(r) || []).map(o => ({ id:id(o.from), text:label(o.from) + " @" + o.attr, color:"ref" })),
        broken:(broken.get(r) || []).map(b => "@" + b.attr + " → " + b.v + " (not found in this file)")
      };
    }
  };
  /* sibling positions are counted once per parent, the first time one of its children needs a path */
  function xpath(r){
    if (!nth) { nth = new Int32Array(E.length); same = new Int32Array(E.length); }
    const parts = [];
    for (let x = r; x; x = x.parent) {
      const p = x.parent;
      if (p && !nth[x.i]) { const c = new Map(); for (const k of p.kids) c.set(k.tag, nth[k.i] = (c.get(k.tag) || 0) + 1); for (const k of p.kids) same[k.i] = c.get(k.tag); }
      parts.unshift(x.tag + (p && same[x.i] > 1 ? "[" + nth[x.i] + "]" : ""));
    }
    return "/" + parts.join("/");
  }
}

/* ---------------- S-100 Feature Catalogue: the chosen type is the sun, linked types orbit it by kind of link ---------------- */
const KIND_COL = { ft:"#10b981", it:"#3b82f6", fa:"#f59e0b", ia:"#eab308", ro:"#ec4899", ca:"#a855f7", sa:"#64748b" };
const CAT_COL = { super:"#f97316", sub:"#fdba74", in:"#8b5cf6", used:"#8b5cf6", feat:"#10b981", info:"#3b82f6", attr:"#14b8a6", parts:"#14b8a6", val:"#475569", roles:"#ec4899", assoc:"#ec4899" };
const PLANET = { ft:13, it:12, fa:10, ia:10, ro:9, ca:10, sa:8 };

function catalogueSource(FC, startKey, fileName){
  const F = XO.fc;
  const palette = new Map();
  for (const [k, v] of Object.entries(F.KIND)) palette.set("k:" + k, { color:KIND_COL[k], title:v.one, body:true });
  for (const c of ["super","sub","feat","info","in","roles","attr","val"]) palette.set("c:" + c, { color:CAT_COL[c], title:{ super:"Inherits from", sub:"Subtypes", feat:"Feature links", info:"Information links", in:"Links in / used by", roles:"Associations, roles", attr:"Attributes, parts", val:"Allowed values" }[c] });
  const catKey = c => "c:" + ({ used:"in", parts:"attr", assoc:"roles" }[c] || c);
  const vals = new Map(), missing = new Map();
  const nid = e => e.val ? "v:" + e.attr.code + ":" + e.val.code : e.item.missing ? "x:" + e.item.code : F.keyOf(e.item);
  const root = FC.by.get(startKey);
  return {
    mode:"links", fileName, palette, total:FC.items.length, rootId:startKey, FC,
    title:root.name || root.code,
    has: x => FC.by.has(x) || vals.has(x) || missing.has(x),
    node(x){
      const it = FC.by.get(x);
      if (it) return { id:x, label:it.name || it.code, color:"k:" + it.kind, size:x === startKey ? 28 : PLANET[it.kind], kind:F.KIND[it.kind].one, abstract:it.abstract };
      const v = vals.get(x); if (v) return { id:x, label:v.val.code + " · " + (v.val.label || ""), color:"c:val", size:5, kind:"Allowed value" };
      const m = missing.get(x); if (m) return { id:x, label:m + " (not defined)", color:"miss", size:7, kind:"Missing" };
      return null;
    },
    canOpen: x => { const it = FC.by.get(x); return !!it && F.branches(it).length > 0; },
    groups(x){
      const it = FC.by.get(x); if (!it) return [];
      return F.branches(it).map(g => ({ key:g.cat, title:F.CAT[g.cat].title, color:catKey(g.cat),
        entries:g.entries.map(e => { const i = nid(e); if (e.val) vals.set(i, e); else if (e.item.missing) missing.set(i, e.item.code);
          return { id:i, short:clip(e.short ?? e.label ?? "", 30), label:e.label || "", inherited:!!e.inherited }; }) }));
    },
    refs: () => [],
    pathTo(x){
      const t = FC.by.get(x); if (!t) return null;
      if (t === root) return [startKey];
      /* follow only links that groups() shows as orbits, so the path can always be opened */
      const prev = new Map([[root, null]]), q = [root];
      while (q.length && !prev.has(t)) {
        const x = q.shift();
        for (const g of F.branches(x)) for (const e of g.entries) {
          const it = e.item; if (!it || it.missing || prev.has(it)) continue;
          prev.set(it, x); q.push(it);
        }
      }
      if (!prev.has(t)) return null;
      const out = []; for (let x = t; x; x = prev.get(x)) out.unshift(F.keyOf(x));
      return out;
    },
    search(q){
      q = q.trim().toLowerCase(); if (!q) return [];
      return FC.items.filter(i => (i.name || "").toLowerCase().includes(q) || i.code.toLowerCase().includes(q) || i.alias.some(a => a.toLowerCase().includes(q)))
        .slice(0, 40).map(i => ({ id:F.keyOf(i), label:i.name || i.code, sub:F.KIND[i.kind].one + " · " + i.code, canCentre:true }));
    },
    info(x){
      const it = FC.by.get(x);
      if (!it) { const v = vals.get(x); if (v) return { kind:"Allowed value", title:v.val.label, code:v.attr.code + " = " + v.val.code, def:v.val.def && v.val.def !== "." ? v.val.def : "", facts:[] };
        return { kind:"Missing", title:missing.get(x) || x, code:"", def:"Referenced but not defined in the catalogue.", facts:[] }; }
      const facts = [];
      if (it.abstract) facts.push("abstract");
      if (it.useType) facts.push(it.useType);
      for (const p of it.prims || []) facts.push(p);
      if (it.valueType) facts.push(it.valueType);
      if (it.uom) facts.push(it.uom);
      for (const a of it.alias) facts.push("alias " + a);
      return { kind:F.KIND[it.kind].one + (x === startKey ? " · the sun" : ""), title:it.name || it.code, code:it.code,
        def:it.def && it.def !== "." ? it.def : "", facts,
        orbits:F.branches(it).map(g => ({ color:catKey(g.cat), title:F.CAT[g.cat].title, count:g.entries.length })) };
    }
  };
}

XO.sources = { xmlSource, catalogueSource, PALETTE };
})();
