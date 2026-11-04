/* A source turns a parsed XML document into bodies and orbits. It answers a fixed set of questions,
   so the orbit engine and the drawing never depend on how the answers are worked out:
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
/* attributes that point at another element's id: the common names, plus any name ending in Ref or Refs (bookRef, targetRefs) */
const REF_ATTR = n => /^(ref|href|idref|idrefs|target|refid|xref)$/i.test(n) || /Refs?$/.test(n) || /^ref[A-Z]/.test(n);

/* Bytes to text. A byte-order mark decides first (UTF-16 or UTF-8); then valid UTF-8 wins, because files are often
   mislabelled; otherwise the encoding the XML declaration names (XML 1.0 §4.3.3), falling back to windows-1252. */
function decode(buf){
  const u = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  if (u[0] === 0xFF && u[1] === 0xFE) return new TextDecoder("utf-16le").decode(buf);
  if (u[0] === 0xFE && u[1] === 0xFF) return new TextDecoder("utf-16be").decode(buf);
  if (u[0] === 0x3C && u[1] === 0) return new TextDecoder("utf-16le").decode(buf);
  if (u[0] === 0 && u[1] === 0x3C) return new TextDecoder("utf-16be").decode(buf);
  try { return new TextDecoder("utf-8", { fatal:true }).decode(buf); } catch {}
  const head = new TextDecoder("latin1").decode(new Uint8Array(buf.slice(0, 300)));
  const m = /encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head);
  try { return new TextDecoder(m ? m[1] : "windows-1252").decode(buf); } catch { return new TextDecoder("utf-8").decode(buf); }
}
XO.decode = decode;

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
  palette.set("ref", { color:"#e2e8f0", title:"Points to (id reference)" });

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
    mode:"tree", fileName, palette, total:E.length, rootId:id(E[0]),
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
