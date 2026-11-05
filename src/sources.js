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

/* ---------------- colours: one per tag name, as different from each other as possible ----------------
   A hand-picked high-contrast set goes first. After that each new colour is the candidate furthest
   (in OKLab, a space where distance matches how different colours look) from every colour already used.
   Candidates are kept light enough to read on the near-black background. */
const SEEDS = ["#ff4d4f","#3b9bff","#2fd67b","#ffd23f","#b67cff","#ff8a1f","#22d3ee","#ff6bcb","#a3e635","#f5f5f5","#c08457","#7f8cff"];
const PALETTE = SEEDS;
const toLin = v => (v /= 255) <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
const toByte = v => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)));
function hexLab(hex){
  const n = parseInt(hex.slice(1), 16), r = toLin(n >> 16), g = toLin(n >> 8 & 255), b = toLin(n & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363032055 * g + 0.0514459158 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function labHex(L, a, b){
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  if (rgb.some(v => v < -0.002 || v > 1.002)) return null;
  return "#" + rgb.map(v => toByte(v).toString(16).padStart(2, "0")).join("");
}
const colourList = [], colourState = { cands:null, minD:null };
function colours(n){
  if (colourList.length >= n) return colourList.slice(0, n);
  if (!colourState.cands) {
    const c = [];
    for (const L of [0.64, 0.70, 0.76, 0.82, 0.88, 0.93]) for (const C of [0.07, 0.11, 0.15, 0.19, 0.23]) for (let h = 0; h < 360; h += 5) {
      const hex = labHex(L, C * Math.cos(h * Math.PI / 180), C * Math.sin(h * Math.PI / 180));
      if (hex) c.push({ hex, lab:hexLab(hex) });
    }
    colourState.cands = c; colourState.minD = c.map(() => Infinity);
  }
  const { cands, minD } = colourState;
  const use = lab => { for (let i = 0; i < cands.length; i++) { const q = cands[i].lab, d = Math.hypot(q[0] - lab[0], q[1] - lab[1], q[2] - lab[2]); if (d < minD[i]) minD[i] = d; } };
  while (colourList.length < n) {
    let hex;
    if (colourList.length < SEEDS.length) hex = SEEDS[colourList.length];
    else { let bi = 0; for (let i = 1; i < cands.length; i++) if (minD[i] > minD[bi]) bi = i; hex = cands[bi].hex; }
    colourList.push(hex); use(hexLab(hex));
  }
  return colourList.slice(0, n);
}
/* dark or light text, whichever reads better on this colour */
function inkFor(hex){
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return "#ffffff";
  const n = parseInt(hex.slice(1), 16), Y = 0.2126 * toLin(n >> 16) + 0.7152 * toLin(n >> 8 & 255) + 0.0722 * toLin(n & 255);
  return Y > 0.18 ? "#0b0b12" : "#ffffff";
}

/* ---------------- display names: how tag names are shown (the file itself is never changed) ----------------
   full      S100FC:S100_FC_DefinitionSources   as written in the file
   shorter   FC_DefinitionSources               no namespace prefix, only the last code part kept
   shortest  DefinitionSources                  no namespace prefix, no code parts
   Code parts are leading pieces in capitals and digits followed by "_" (S100_, FC_, CI_ …).
   A custom name for a tag wins over the style. */
const names = { style:"full", custom:new Map() };
const localOf = t => t.slice(t.indexOf(":") + 1);
function styledName(tag, style){
  if (style !== "shorter" && style !== "shortest") return tag;
  const loc = localOf(tag), parts = loc.split("_");
  let c = 0; while (c < parts.length - 1 && /^[A-Z0-9]+$/.test(parts[c]) && parts[c + 1]) c++;
  const out = parts.slice(style === "shortest" ? c : Math.max(0, c - 1)).join("_");
  return out || loc || tag;
}
names.show = tag => names.custom.get(tag) || styledName(tag, names.style);
names.styled = styledName;
XO.names = names;
const dn = tag => names.show(tag);

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
  const cols = colours(tags.length);
  const palette = new Map(tags.map((t, i) => ["t:" + t, { color:cols[i], tag:t, get title(){ return "<" + dn(t) + ">"; }, count:tagCount.get(t) }]));
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
  for (const r of E) r.key = keyOf(r);

  /* The file's own name: the root's <…:name> child, or else the file name. It labels the centre. */
  const R0 = E[0];
  const nameRec = R0.kids.find(k => k.el.localName === "name" && !k.kids.length && k.el.textContent.trim());
  const fileTitle = nameRec ? nameRec.el.textContent.trim() : String(fileName || "").split(/[\\/]/).pop() || R0.tag;
  /* labels follow the chosen display names, so they are worked out each time */
  const labelOf = r => r.depth === 0 ? (names.custom.get(r.tag) || fileTitle) : r.key ? dn(r.tag) + " · " + clip(r.key, 40) : dn(r.tag);

  /* Header: the fields at the top of the file that describe it (name, scope, version, producer …).
     A text-only child of the root is one field; a small child with parts of its own (like producer) lists its text parts.
     The header ends at the first child that is content rather than a description: a list (several children
     of one tag), a big block, or a tag the root repeats. */
  function header(){
    const seen = new Map(); for (const k of R0.kids) seen.set(k.tag, (seen.get(k.tag) || 0) + 1);
    const isList = k => k.kids.length > 1 && k.kids.every(c => c.tag === k.kids[0].tag);
    const keyName = r => names.custom.get(r.tag) || localOf(r.tag);
    const out = [];
    for (const k of R0.kids) {
      if (k === nameRec) continue;
      if (seen.get(k.tag) > 1 || k.desc > 24 || isList(k)) break;
      if (!k.kids.length) { const v = k.el.textContent.trim(); if (v) out.push({ key:keyName(k), value:v }); continue; }
      const items = [], st = [...k.kids].reverse();
      while (st.length) { const x = st.pop(); if (x.kids.length) { for (let i = x.kids.length - 1; i >= 0; i--) st.push(x.kids[i]); continue; } const v = x.el.textContent.trim(); if (v) items.push({ key:keyName(x), value:v }); }
      if (items.length) out.push({ key:keyName(k), items });
    }
    return out;
  }

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
    title:fileTitle, rootTag:R0.tag, startOpen:false, header,
    has: x => !!rec(x),
    tagOf: x => rec(x)?.tag || "",
    node(x){ const r = rec(x); return r && { id:x, label:labelOf(r), color:"t:" + r.tag, size:size(r), kind:"<" + dn(r.tag) + ">", tag:r.tag, kids:r.kids.length }; },
    canOpen: x => { const r = rec(x); return !!r && r.kids.length > 0; },
    groups(x){
      const r = rec(x); if (!r) return [];
      const by = new Map();
      for (const k of r.kids) { if (!by.has(k.tag)) by.set(k.tag, []); by.get(k.tag).push(k); }
      return [...by].map(([tag, ks]) => ({ key:"t:" + tag, title:"<" + dn(tag) + ">", color:"t:" + tag,
        entries:ks.map(k => ({ id:id(k), short:"", label:"child <" + dn(tag) + ">" })) }));
    },
    refs(x){ const r = rec(x); return (out.get(r) || []).map(o => ({ to:id(o.to), color:"ref", short:"@" + o.attr, label:o.attr + " → " + labelOf(o.to) })); },
    pathTo(x){ const c = []; for (let r = rec(x); r; r = r.parent) c.unshift(id(r)); return c; },
    search(q){
      q = q.trim().toLowerCase(); if (!q) return [];
      const res = [];
      for (const r of E) {
        if (r.tag.toLowerCase().includes(q) || dn(r.tag).toLowerCase().includes(q) || r.key.toLowerCase().includes(q) || (r.depth === 0 && fileTitle.toLowerCase().includes(q))) res.push(r);
        else for (const at of r.el.attributes) if (at.value.toLowerCase().includes(q)) { res.push(r); break; }
        if (res.length >= 40) break;
      }
      return res.map(r => ({ id:id(r), label:labelOf(r), sub:xpath(r) }));
    },
    info(x){
      const r = rec(x); if (!r) return null;
      const direct = [...r.el.childNodes].filter(n => n.nodeType === 3 || n.nodeType === 4).map(n => n.nodeValue).join("").trim();
      const kidTags = new Map(); for (const k of r.kids) kidTags.set(k.tag, (kidTags.get(k.tag) || 0) + 1);
      return {
        kind:"Element <" + r.tag + ">" + (r.depth === 0 ? " · the root element" : ""), title:r.depth === 0 ? labelOf(r) : r.key || dn(r.tag), code:xpath(r), tag:r.tag,
        header:r.depth === 0 ? header() : null,
        def: direct ? clip(direct, 600) : "",
        attrs:[...r.el.attributes].map(a => [a.name, a.value]),
        facts:[r.kids.length ? r.kids.length + " child element" + (r.kids.length === 1 ? "" : "s") : "no child elements", r.desc > r.kids.length ? r.desc + " elements inside in all" : "", r.el.namespaceURI ? "ns " + r.el.namespaceURI : ""].filter(Boolean),
        orbits:[...kidTags].map(([t, n]) => ({ color:"t:" + t, title:"<" + dn(t) + ">", count:n })),
        linksOut:(out.get(r) || []).map(o => ({ id:id(o.to), text:"@" + o.attr + " → " + labelOf(o.to), color:"ref" })),
        linksIn:(inn.get(r) || []).map(o => ({ id:id(o.from), text:labelOf(o.from) + " @" + o.attr, color:"ref" })),
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
  const kidCount = new Map();
  const kidsOf = it => { let n = kidCount.get(it); if (n == null) { n = F.branches(it).reduce((s, g) => s + g.entries.length, 0); kidCount.set(it, n); } return n; };
  return {
    mode:"links", fileName, palette, total:FC.items.length, rootId:startKey, FC,
    title:root.name || root.code,
    has: x => FC.by.has(x) || vals.has(x) || missing.has(x),
    node(x){
      const it = FC.by.get(x);
      if (it) return { id:x, label:it.name || it.code, color:"k:" + it.kind, size:x === startKey ? 28 : PLANET[it.kind], kind:F.KIND[it.kind].one, abstract:it.abstract, kids:kidsOf(it) };
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

XO.sources = { xmlSource, catalogueSource, PALETTE, colours, inkFor };
})();
