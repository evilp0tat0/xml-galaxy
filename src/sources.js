/* A source turns a parsed XML document into bodies and orbits.
   It answers these questions for the orbit engine and the drawing:
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
  const byEl = new Map();
  /* iterative walk, so very deep files cannot overflow the stack; tags keep their prefix (a:item and b:item differ) */
  (function walk(rootEl){
    const stack = [[rootEl, null, 0]];
    while (stack.length) {
      const [el, parent, depth] = stack.pop();
      const rec = { i:E.length, el, parent, depth, tag:el.nodeName, kids:[], desc:0 };
      E.push(rec); byEl.set(el, rec);
      if (parent) parent.kids.push(rec);
      for (let c = el.lastElementChild; c; c = c.previousElementSibling) stack.push([c, rec, depth + 1]);
    }
    for (let i = E.length - 1; i > 0; i--) E[i].parent.desc += E[i].desc + 1;
  })(doc.documentElement);
  const id = r => "e" + r.i;
  const rec = idv => E[+String(idv).slice(1)];

  /* colour per tag, most common tags get the most distinct colours */
  const tagCount = new Map();
  for (const r of E) tagCount.set(r.tag, (tagCount.get(r.tag) || 0) + 1);
  const tags = [...tagCount.keys()].sort((a, b) => tagCount.get(b) - tagCount.get(a));
  const palette = new Map(tags.map((t, i) => ["t:" + t, { color:PALETTE[i % PALETTE.length], title:"<" + t + ">", count:tagCount.get(t) }]));
  palette.set("ref", { color:"#22d3ee", title:"Points to (id reference)" });

  /* a short human name for an element: its tag plus a telling attribute or child */
  function keyOf(r){
    const el = r.el;
    for (const a of KEY_ATTRS) { const v = el.getAttribute(a); if (v) return v; }
    for (const at of el.attributes) if (at.localName === "id" || at.localName === "name") return at.value;
    for (const at of el.attributes) if (REF_ATTR(at.localName)) return "→ " + at.value.replace(/^#/, "");
    for (const c of el.children) if (KEY_CHILDREN.includes(c.localName) && !c.children.length) { const v = c.textContent.trim(); if (v) return v; }
    if (!el.children.length) { const v = el.textContent.trim(); if (v) return v; }
    return "";
  }
  for (const r of E) { r.key = keyOf(r); r.label = r.key ? r.tag + " · " + clip(r.key, 40) : r.tag; }

  /* id / idref links */
  const ids = new Map();
  for (const r of E) for (const at of r.el.attributes) if (ID_ATTRS.has(at.name) || at.localName === "id") ids.set(at.value, r);
  const out = new Map(), inn = new Map(), broken = new Map();
  for (const r of E) for (const at of r.el.attributes) {
    if (!REF_ATTR(at.localName) || ID_ATTRS.has(at.name)) continue;
    for (const raw of at.value.split(/\s+/)) {
      const v = raw.replace(/^#/, ""), t = ids.get(v);
      if (!v || t === r) continue;
      if (!t) { (broken.get(r) || broken.set(r, []).get(r)).push({ attr:at.name, v }); continue; }
      (out.get(r) || out.set(r, []).get(r)).push({ to:t, attr:at.name });
      (inn.get(t) || inn.set(t, []).get(t)).push({ from:r, attr:at.name });
    }
  }

  const size = r => r.depth === 0 ? 26 : Math.min(17, 4.5 + 2.3 * Math.log2(1 + r.desc));
  return {
    fileName, palette, total:E.length, rootId:id(E[0]),
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
        linksIn:(inn.get(r) || []).map(o => ({ id:id(o.from), text:o.from.label + " @" + o.attr, color:"ref" })),
        broken:(broken.get(r) || []).map(b => "@" + b.attr + " → " + b.v + " (not found in this file)")
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

XO.sources = { xmlSource, PALETTE };
})();
