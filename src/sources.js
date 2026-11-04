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

/* Line and body colours for a dark sky: bright, distinct, readable on near-black. */
const PALETTE = ["#2dd4bf","#60a5fa","#f472b6","#fbbf24","#a78bfa","#34d399","#fb923c","#38bdf8","#f87171","#c084fc","#a3e635","#e879f9","#facc15","#4ade80","#93c5fd","#fda4af"];

/* ---------------- any XML: the root element is the sun, child elements orbit their parent ---------------- */
const KEY_ATTRS = ["name", "id", "code", "key", "title", "label", "type"];
const KEY_CHILDREN = ["name", "code", "title", "label", "identifier"];
const ID_ATTRS = new Set(["id", "ID", "Id", "xml:id"]);
const REF_ATTR = n => /^(ref|href|idref|idrefs|target|refid|xref)$/i.test(n) || /Ref$/.test(n) || /^ref[A-Z]/.test(n);

function xmlSource(doc, fileName){
  const E = [];              /* index → element record */
  const byEl = new Map();
  (function walk(el, parent, depth){
    const rec = { i:E.length, el, parent, depth, tag:el.localName, prefix:el.prefix || "", kids:[], desc:0 };
    E.push(rec); byEl.set(el, rec);
    if (parent) parent.kids.push(rec);
    for (const c of el.children) walk(c, rec, depth + 1);
    if (parent) parent.desc += rec.desc + 1;
  })(doc.documentElement, null, 0);
  const id = r => "e" + r.i;
  const rec = idv => E[+String(idv).slice(1)];

  /* colour per tag, most common tags get the most distinct colours */
  const tagCount = new Map();
  for (const r of E) tagCount.set(r.tag, (tagCount.get(r.tag) || 0) + 1);
  const tags = [...tagCount.keys()].sort((a, b) => tagCount.get(b) - tagCount.get(a));
  const palette = new Map(tags.map((t, i) => ["t:" + t, { color:PALETTE[i % PALETTE.length], title:"<" + t + ">", count:tagCount.get(t) }]));
  palette.set("ref", { color:"#e2e8f0", title:"Points to (id reference)" });

  /* a short human name for an element: its tag plus a telling attribute or child */
  function keyOf(r){
    const el = r.el;
    for (const a of KEY_ATTRS) { const v = el.getAttribute(a); if (v) return v; }
    for (const at of el.attributes) if (REF_ATTR(at.localName)) return "→ " + at.value.replace(/^#/, "");
    for (const at of el.attributes) if (/:?(id|name)$/i.test(at.name)) return at.value;
    for (const c of el.children) if (KEY_CHILDREN.includes(c.localName) && !c.children.length) { const v = c.textContent.trim(); if (v) return v; }
    if (!el.children.length) { const v = el.textContent.trim(); if (v) return v; }
    return "";
  }
  for (const r of E) { r.key = keyOf(r); r.label = r.key ? r.tag + " · " + clip(r.key, 40) : r.tag; }

  /* id / idref links */
  const ids = new Map();
  for (const r of E) for (const at of r.el.attributes) if (ID_ATTRS.has(at.name) || at.localName === "id") ids.set(at.value, r);
  const out = new Map(), inn = new Map();
  for (const r of E) for (const at of r.el.attributes) {
    if (!REF_ATTR(at.localName) || ID_ATTRS.has(at.name)) continue;
    for (const raw of at.value.split(/\s+/)) {
      const v = raw.replace(/^#/, ""), t = ids.get(v);
      if (!t || t === r) continue;
      (out.get(r) || out.set(r, []).get(r)).push({ to:t, attr:at.name });
      (inn.get(t) || inn.set(t, []).get(t)).push({ from:r, attr:at.name });
    }
  }

  const size = r => r.depth === 0 ? 26 : Math.min(17, 4.5 + 2.3 * Math.log2(1 + r.desc));
  return {
    mode:"tree", mergeRings:true, fileName, palette, total:E.length, rootId:id(E[0]),
    title:"<" + E[0].tag + ">",
    has: x => !!rec(x),
    node(x){ const r = rec(x); return r && { id:x, label:r.label, color:"t:" + r.tag, size:size(r), kind:"<" + r.tag + ">" }; },
    canOpen: x => { const r = rec(x); return !!r && r.kids.length > 0; },
    groups(x){
      const r = rec(x); if (!r) return [];
      const by = new Map();
      for (const k of r.kids) { if (!by.has(k.tag)) by.set(k.tag, []); by.get(k.tag).push(k); }
      return [...by].map(([tag, ks]) => ({ key:"t:" + tag, title:"<" + tag + ">", color:"t:" + tag,
        entries:ks.map(k => ({ id:id(k), short:"", label:"child <" + tag + ">" })) }));
    },
    refs(x){ const r = rec(x); return (out.get(r) || []).map(o => ({ to:id(o.to), color:"ref", short:"@" + o.attr, label:o.attr + " → " + o.to.label })); },
    pathTo(x){ const c = []; for (let r = rec(x); r; r = r.parent) c.unshift(id(r)); return c; },
    search(q){
      q = q.trim().toLowerCase(); if (!q) return [];
      const res = [];
      for (const r of E) {
        if (r.tag.toLowerCase().includes(q) || r.key.toLowerCase().includes(q)) res.push(r);
        else for (const at of r.el.attributes) if (at.value.toLowerCase().includes(q)) { res.push(r); break; }
        if (res.length >= 40) break;
      }
      return res.map(r => ({ id:id(r), label:r.label, sub:xpath(r) }));
    },
    info(x){
      const r = rec(x); if (!r) return null;
      const direct = [...r.el.childNodes].filter(n => n.nodeType === 3 || n.nodeType === 4).map(n => n.nodeValue).join("").trim();
      const kidTags = new Map(); for (const k of r.kids) kidTags.set(k.tag, (kidTags.get(k.tag) || 0) + 1);
      return {
        kind:"Element <" + r.tag + ">" + (r.depth === 0 ? " · the centre" : ""), title:r.key || r.tag, code:xpath(r),
        def: direct ? clip(direct, 600) : "",
        attrs:[...r.el.attributes].map(a => [a.name, a.value]),
        facts:[r.desc ? r.desc + " elements inside" : "no child elements", r.el.namespaceURI ? "ns " + r.el.namespaceURI : ""].filter(Boolean),
        orbits:[...kidTags].map(([t, n]) => ({ color:"t:" + t, title:"<" + t + ">", count:n })),
        linksOut:(out.get(r) || []).map(o => ({ id:id(o.to), text:"@" + o.attr + " → " + o.to.label, color:"ref" })),
        linksIn:(inn.get(r) || []).map(o => ({ id:id(o.from), text:o.from.label + " @" + o.attr, color:"ref" }))
      };
    }
  };
  function xpath(r){
    const parts = [];
    for (let x = r; x; x = x.parent) {
      const same = x.parent ? x.parent.kids.filter(k => k.tag === x.tag) : [x];
      parts.unshift(x.tag + (same.length > 1 ? "[" + (same.indexOf(x) + 1) + "]" : ""));
    }
    return "/" + parts.join("/");
  }
}

/* ---------------- S-100 Feature Catalogue: the chosen type is the sun, linked types orbit it by kind of link ---------------- */
const KIND_COL = { ft:"#2dd4bf", it:"#60a5fa", fa:"#fb923c", ia:"#facc15", ro:"#fb7185", ca:"#a78bfa", sa:"#94a3b8" };
const CAT_COL = { super:"#a78bfa", sub:"#c4b5fd", in:"#fb923c", used:"#fb923c", feat:"#2dd4bf", info:"#60a5fa", attr:"#64748b", parts:"#64748b", val:"#475569", roles:"#fb7185", assoc:"#fb7185" };
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
      const steps = F.bfs(root, t, false) || F.bfs(root, t, true);
      return steps ? [startKey, ...steps.map(s => F.keyOf(s.to))] : null;
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
