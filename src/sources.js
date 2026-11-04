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
const KEY_CHILDREN = ["name", "code", "title", "label", "identifier"];
const ID_ATTRS = new Set(["id", "ID", "Id", "xml:id"]);
const REF_ATTR = n => /^(ref|href|idref|idrefs|target|refid|xref)$/i.test(n) || /Ref$/.test(n) || /^ref[A-Z]/.test(n);

function xmlSource(doc, fileName){
  const E = [];              /* index → element record */
  const tagCount = new Map(), ids = new Map(), refCands = [];
  const isRef = new Map();   /* attribute local name → is it a reference? (asked once per name, not per attribute) */
  /* One walk does everything that needs every element: records, tag counts, ids and references.
     It is iterative, so very deep files cannot overflow the stack; tags keep their prefix (a:item and b:item differ). */
  (function walk(rootEl){
    const els = [rootEl], parents = [null];
    while (els.length) {
      const el = els.pop(), parent = parents.pop();
      const rec = { i:E.length, el, parent, depth:parent ? parent.depth + 1 : 0, tag:el.nodeName, kids:[], desc:0, key:undefined, label:undefined };
      E.push(rec);
      if (parent) parent.kids.push(rec);
      tagCount.set(rec.tag, (tagCount.get(rec.tag) || 0) + 1);
      if (el.hasAttributes()) {
        const at = el.attributes;
        for (let j = 0; j < at.length; j++) {
          const a = at[j], ln = a.localName;
          if (ID_ATTRS.has(a.name) || ln === "id") { ids.set(a.value, rec); continue; }
          let r = isRef.get(ln); if (r === undefined) isRef.set(ln, r = REF_ATTR(ln));
          if (r) refCands.push(rec, a.name, a.value);
        }
      }
      for (let c = el.lastElementChild; c; c = c.previousElementSibling) { els.push(c); parents.push(rec); }
    }
    for (let i = E.length - 1; i > 0; i--) E[i].parent.desc += E[i].desc + 1;
  })(doc.documentElement);
  const id = r => "e" + r.i;
  const rec = idv => E[+String(idv).slice(1)];

  /* colour per tag, most common tags get the most distinct colours */
  const tags = [...tagCount.keys()].sort((a, b) => tagCount.get(b) - tagCount.get(a));
  const palette = new Map(tags.map((t, i) => ["t:" + t, { color:PALETTE[i % PALETTE.length], title:"<" + t + ">", count:tagCount.get(t) }]));
  palette.set("ref", { color:"#22d3ee", title:"Points to (id reference)" });

  /* a short human name for an element: its tag plus a telling attribute or child.
     Worked out only when something asks for it: a big file has far more elements than are ever shown. */
  function keyOf(r){
    const el = r.el;
    if (el.hasAttributes()) {
      for (const a of KEY_ATTRS) { const v = el.getAttribute(a); if (v) return v; }
      for (const at of el.attributes) if (at.localName === "id" || at.localName === "name") return at.value;
      for (const at of el.attributes) if (REF_ATTR(at.localName)) return "→ " + at.value.replace(/^#/, "");
    }
    if (!el.firstElementChild) return el.textContent.trim();
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (KEY_CHILDREN.includes(c.localName) && !c.firstElementChild) { const v = c.textContent.trim(); if (v) return v; }
    return "";
  }
  const key = r => { if (r.key === undefined) r.key = keyOf(r); return r.key; };
  const label = r => { if (r.label === undefined) { const k = key(r); r.label = k ? r.tag + " · " + clip(k, 40) : r.tag; } return r.label; };

  /* id / idref links, resolved once every id is known */
  const out = new Map(), inn = new Map(), broken = new Map();
  for (let j = 0; j < refCands.length; j += 3) {
    const r = refCands[j], attr = refCands[j + 1];
    for (const raw of refCands[j + 2].split(/\s+/)) {
      const v = raw.replace(/^#/, ""), t = ids.get(v);
      if (!v || t === r) continue;
      if (!t) { (broken.get(r) || broken.set(r, []).get(r)).push({ attr, v }); continue; }
      (out.get(r) || out.set(r, []).get(r)).push({ to:t, attr });
      (inn.get(t) || inn.set(t, []).get(t)).push({ from:r, attr });
    }
  }

  /* Search runs over one lower-case string per element (tag, name, attribute values), built once.
     warm() builds it a slice at a time while the page is idle, so the first search does not stall. */
  const hay = [];
  function warm(ms = 1e9){
    const t0 = performance.now();
    while (hay.length < E.length) {
      const r = E[hay.length], parts = [r.tag, key(r)];
      if (r.el.hasAttributes()) for (const at of r.el.attributes) parts.push(at.value);
      hay.push(parts.join("\u0000").toLowerCase());
      if ((hay.length & 511) === 0 && performance.now() - t0 > ms) return false;
    }
    return true;
  }
  /* where an element sits among same-tag siblings, counted once per parent */
  function nth(x){
    const p = x.parent; if (!p) return [1, 1];
    if (!p.same) { p.same = new Map(); for (const k of p.kids) { const c = (p.same.get(k.tag) || 0) + 1; p.same.set(k.tag, c); k.nth = c; } }
    return [x.nth, p.same.get(x.tag)];
  }
  function xpath(r){
    const parts = [];
    for (let x = r; x; x = x.parent) { const [i, n] = nth(x); parts.unshift(x.tag + (n > 1 ? "[" + i + "]" : "")); }
    return "/" + parts.join("/");
  }
  const groupMemo = new Map();

  const size = r => r.depth === 0 ? 26 : Math.min(17, 4.5 + 2.3 * Math.log2(1 + r.desc));
  return {
    mode:"tree", fileName, palette, total:E.length, rootId:id(E[0]),
    title:"<" + E[0].tag + ">",
    warm,
    has: x => !!rec(x),
    node(x){ const r = rec(x); return r && { id:x, label:label(r), color:"t:" + r.tag, size:size(r), kind:"<" + r.tag + ">" }; },
    canOpen: x => { const r = rec(x); return !!r && r.kids.length > 0; },
    groups(x){
      const r = rec(x); if (!r) return [];
      let gs = groupMemo.get(r);
      if (!gs) {
        const by = new Map();
        for (const k of r.kids) { let l = by.get(k.tag); if (!l) by.set(k.tag, l = []); l.push(k); }
        gs = [...by].map(([tag, ks]) => ({ key:"t:" + tag, title:"<" + tag + ">", color:"t:" + tag,
          entries:ks.map(k => ({ id:id(k), short:"", label:"child <" + tag + ">" })) }));
        groupMemo.set(r, gs);
      }
      return gs;
    },
    refs(x){ const r = rec(x); return (out.get(r) || []).map(o => ({ to:id(o.to), color:"ref", short:"@" + o.attr, label:o.attr + " → " + label(o.to) })); },
    pathTo(x){ const c = []; for (let r = rec(x); r; r = r.parent) c.unshift(id(r)); return c; },
    search(q){
      q = q.trim().toLowerCase(); if (!q) return [];
      warm();
      const res = [];
      for (let i = 0; i < hay.length && res.length < 40; i++) if (hay[i].includes(q)) res.push(E[i]);
      return res.map(r => ({ id:id(r), label:label(r), sub:xpath(r) }));
    },
    info(x){
      const r = rec(x); if (!r) return null;
      const direct = [...r.el.childNodes].filter(n => n.nodeType === 3 || n.nodeType === 4).map(n => n.nodeValue).join("").trim();
      const kidTags = new Map(); for (const k of r.kids) kidTags.set(k.tag, (kidTags.get(k.tag) || 0) + 1);
      return {
        kind:"Element <" + r.tag + ">" + (r.depth === 0 ? " · the centre" : ""), title:key(r) || r.tag, code:xpath(r),
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
  const root = FC.by.get(startKey), groupMemo = new Map();
  let reach = null;
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
      let gs = groupMemo.get(x);
      if (!gs) groupMemo.set(x, gs = F.branches(it).map(g => ({ key:g.cat, title:F.CAT[g.cat].title, color:catKey(g.cat),
        entries:g.entries.map(e => { const i = nid(e); if (e.val) vals.set(i, e); else if (e.item.missing) missing.set(i, e.item.code);
          return { id:i, short:clip(e.short ?? e.label ?? "", 30), label:e.label || "", inherited:!!e.inherited }; }) })));
      return gs;
    },
    refs: () => [],
    pathTo(x){
      const t = FC.by.get(x); if (!t) return null;
      if (t === root) return [startKey];
      /* follow only links that groups() shows as orbits, so the path can always be opened;
         the whole breadth-first tree from the sun is walked once and kept */
      if (!reach) {
        reach = new Map([[root, null]]); const q = [root];
        for (let i = 0; i < q.length; i++) {
          const x = q[i];
          for (const g of F.branches(x)) for (const e of g.entries) {
            const it = e.item; if (!it || it.missing || reach.has(it)) continue;
            reach.set(it, x); q.push(it);
          }
        }
      }
      const prev = reach;
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
