/* A source turns a parsed XML document into bodies and orbits.
   It answers these questions for the orbit engine and the drawing:
     node(id)      what a body is (label, colour key, size)
     groups(id)    what orbits it, one group per orbit
     refs(id)      extra links to bodies elsewhere (drawn dashed)
     info(id)      what the side panel shows
     explain(id)   what an element is, in plain words, and what defines its name
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
const SEEDS = ["#ff4d4f","#3b9bff","#2fd67b","#ffd23f","#b67cff","#ff8a1f","#ff6bcb","#a3e635","#f5f5f5","#c08457"];
/* reserved for id-reference lines; no tag gets it, and generated colours keep away from it */
const REF_COLOUR = "#22d3ee";
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
const colourList = [], colourState = { cands:null, minD:null,
  use(lab){ const { cands, minD } = colourState; for (let i = 0; i < cands.length; i++) { const q = cands[i].lab, d = Math.hypot(q[0] - lab[0], q[1] - lab[1], q[2] - lab[2]); if (d < minD[i]) minD[i] = d; } } };
function colours(n){
  if (colourList.length >= n) return colourList.slice(0, n);
  if (!colourState.cands) {
    const c = [];
    for (const L of [0.64, 0.70, 0.76, 0.82, 0.88, 0.93]) for (const C of [0.07, 0.11, 0.15, 0.19, 0.23]) for (let h = 0; h < 360; h += 5) {
      const hex = labHex(L, C * Math.cos(h * Math.PI / 180), C * Math.sin(h * Math.PI / 180));
      if (hex) c.push({ hex, lab:hexLab(hex) });
    }
    colourState.cands = c; colourState.minD = c.map(() => Infinity);
    colourState.use(hexLab(REF_COLOUR));
  }
  const { cands, minD } = colourState;
  const use = colourState.use;
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
   The viewer types the parts they do not want to see (S100FC:, S100_FC_ …); each is taken out of every name.
   Matching ignores case. Longer parts go first, so S100_FC_ is taken out whole before S100_.
   Separators left at either end (_ : . -) are trimmed; a name that would end up empty stays as it is.
   A custom name for a tag wins over all of this. */
const names = { hide:[], custom:new Map() };
const localOf = t => t.slice(t.indexOf(":") + 1);
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function strippedName(tag, hide = names.hide){
  let s = tag;
  for (const p of [...hide].sort((a, b) => b.length - a.length)) if (p) s = s.replace(new RegExp(reEsc(p), "gi"), "");
  if (s === tag) return tag;
  s = s.replace(/^[_:.\-]+|[_:.\-]+$/g, "");
  return s || tag;
}
/* Each tag's name with the hidden parts taken out, kept until the parts change: a name is shown for every body, orbit and
   search result, and taking the parts out sorts them and builds a pattern for each, every time. */
let strippedFor = [], strippedMemo = new Map();
function shownStripped(tag){
  const h = names.hide;
  let same = h.length === strippedFor.length;
  for (let i = 0; same && i < h.length; i++) same = h[i] === strippedFor[i];
  if (!same) { strippedFor = [...h]; strippedMemo = new Map(); }
  let s = strippedMemo.get(tag);
  if (s === undefined) strippedMemo.set(tag, s = strippedName(tag, h));
  return s;
}
/* "S100FC: S100_FC_" or "a, b" → the separate parts; tag names never hold spaces or commas */
names.parse = text => String(text || "").split(/[\s,]+/).filter(Boolean);
names.show = tag => names.custom.get(tag) || shownStripped(tag);
names.strip = strippedName;
/* app.js counts up each time the names change; explanations, which use the names, are then worked out afresh */
names.version = 0;
XO.names = names;
const dn = tag => names.show(tag);

/* The file's own name: the root's <…:name> child, or else the file name. It labels the centre, and a dictionary. */
const nameChild = root => { for (let c = root.firstElementChild; c; c = c.nextElementSibling) if (c.localName === "name" && !c.firstElementChild && c.textContent.trim()) return c; return null; };
function titleOf(doc, fileName){
  const root = doc.documentElement, n = nameChild(root);
  return n ? n.textContent.trim() : String(fileName || "").split(/[\\/]/).pop() || root.nodeName;
}

/* ---------------- any XML: the root element is the sun, child elements orbit their parent ---------------- */
const KEY_ATTRS = ["name", "id", "code", "key", "title", "label", "type"];
const KEY_CHILDREN = ["name", "code", "title", "label", "identifier"];
/* the children that hold an element's human name (featureName > name too), for the explanation and the search */
const NAME_TAGS = new Set(["name", "title", "label"]);
const ID_ATTRS = new Set(["id", "ID", "Id", "xml:id"]);
const REF_ATTR = n => /^(ref|href|idref|idrefs|target|refid|xref)$/i.test(n) || /Ref$/.test(n) || /^ref[A-Z]/.test(n);
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd", "th", "th", "th", "th", "th", "th"][n % 10]);
/* how many kinds of term the root's dictionary sentence names */
const KINDS_SHOWN = 8;
/* what a short text plainly is, when that is obvious from its shape */
function typeWord(t){
  if (/^[-+]?\d+([.,]\d+)?$/.test(t)) return "a number";
  if (/^\d{4}-\d{2}(-\d{2})?(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(t)) return "a date";
  if (/^(true|false)$/i.test(t)) return "yes or no";
  if (/^https?:\/\//i.test(t)) return "a web address";
  if (/^[-+]?\d+(\.\d+)?(\s+[-+]?\d+(\.\d+)?)+$/.test(t)) return "coordinates";
  return "";
}

function xmlSource(doc, fileName){
  const E = [];              /* index → element record */
  const tagCount = new Map(), ids = new Map(), refAttrs = [];
  /* what an attribute's name says, worked out once per name rather than once per attribute: 1 an id, 2 a reference, 0 neither
     (an id attribute is never a reference) */
  const attrKinds = new Map();
  const kindOf = n => { let k = attrKinds.get(n); if (k === undefined) { const ln = localOf(n); attrKinds.set(n, k = ID_ATTRS.has(n) || ln === "id" ? 1 : REF_ATTR(ln) ? 2 : 0); } return k; };
  /* One walk in document order collects all that needs every element: its record, tag counts, ids and references.
     It keeps no stack, so very deep files cannot overflow one; tags keep their prefix (a:item and b:item differ). */
  for (let el = doc.documentElement, up = null; el; ) {
    const r = { i:E.length, el, parent:up, depth:up ? up.depth + 1 : 0, tag:el.nodeName, kids:[], desc:0, key:null, name:null };
    E.push(r); if (up) up.kids.push(r);
    tagCount.set(r.tag, (tagCount.get(r.tag) || 0) + 1);
    if (el.hasAttributes()) for (const n of el.getAttributeNames()) {
      const kind = kindOf(n);
      if (kind === 1) ids.set(el.getAttribute(n), r); else if (kind === 2) refAttrs.push(r, n, el.getAttribute(n));
    }
    if (el.firstElementChild) { up = r; el = el.firstElementChild; continue; }
    /* a leaf: on to its next sibling, or else the next sibling of the nearest ancestor that has one */
    while (!(el = el.nextElementSibling) && up) { el = up.el; up = up.parent; }
  }
  for (let i = E.length - 1; i > 0; i--) E[i].parent.desc += E[i].desc + 1;
  const id = r => "e" + r.i;
  const rec = idv => E[+String(idv).slice(1)];

  /* colour per tag, most common tags get the most distinct colours */
  const tags = [...tagCount.keys()].sort((a, b) => tagCount.get(b) - tagCount.get(a));
  const cols = colours(tags.length);
  const palette = new Map(tags.map((t, i) => ["t:" + t, { color:cols[i], tag:t, get title(){ return "<" + dn(t) + ">"; }, count:tagCount.get(t) }]));
  palette.set("ref", { color:REF_COLOUR });

  /* A short human name for an element: its tag plus a telling attribute or child. Worked out when first asked for:
     a big file has far more elements than are ever shown. */
  function keyOf(r){
    if (r.key !== null) return r.key;
    const el = r.el;
    let k = "";
    find: {
      if (el.hasAttributes()) {
        for (const a of KEY_ATTRS) { const v = el.getAttribute(a); if (v) { k = v; break find; } }
        for (const at of el.attributes) if (at.localName === "id" || at.localName === "name") { k = at.value; break find; }
        for (const at of el.attributes) if (REF_ATTR(at.localName)) { k = "→ " + at.value.replace(/^#/, ""); break find; }
      }
      if (!el.firstElementChild) { k = el.textContent.trim(); break find; }
      for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (KEY_CHILDREN.includes(c.localName) && !c.firstElementChild) { const v = c.textContent.trim(); if (v) { k = v; break find; } }
    }
    return r.key = k;
  }
  /* An element's human name, when it has one: a name-like child, or a name-like grandchild through a wrapper that is itself
     named for a name (featureName > name) and appears once. Worked out when first asked for, like keyOf. */
  function nameOf(r){
    if (r.name !== null) return r.name;
    let v = "";
    find: {
      for (const k of r.kids) if (!k.kids.length && NAME_TAGS.has(k.el.localName)) { v = k.el.textContent.trim(); if (v) break find; }
      let seen = 0;
      for (const k of r.kids) {
        if (seen++ >= 16) break;
        if (!k.kids.length || !/name|title|label/i.test(k.el.localName)) continue;
        countSiblings(r); if (r.same.get(k.tag) > 1) continue;
        for (const g of k.kids) if (!g.kids.length && NAME_TAGS.has(g.el.localName)) { v = g.el.textContent.trim(); if (v) break find; }
        if (k.kids.length === 1 && !k.kids[0].kids.length) { v = k.kids[0].el.textContent.trim(); if (v) break find; }
      }
    }
    return r.name = v;
  }
  /* the value of an element's id attribute, or "" */
  const idOf = r => { const el = r.el; if (el.hasAttributes()) for (const a of el.attributes) if (ID_ATTRS.has(a.name) || a.localName === "id") return a.value; return ""; };

  const R0 = E[0], nameEl = nameChild(R0.el);
  const nameRec = nameEl ? R0.kids.find(k => k.el === nameEl) : null;
  const fileTitle = titleOf(doc, fileName);
  /* labels follow the chosen display names, so they are worked out each time */
  const labelOf = r => { if (r.depth === 0) return fileTitle; const k = keyOf(r); return k ? dn(r.tag) + " · " + clip(k, 40) : dn(r.tag); };

  /* Header: the fields at the top of the file that describe it (name, scope, version, producer …).
     A text-only child of the root is one field; a small child with parts of its own (like producer) lists its text parts.
     The header ends at the first child that is content rather than a description: a list (several children
     of one tag), a big block, or a tag the root repeats. */
  function header(){
    const seen = new Map(); for (const k of R0.kids) seen.set(k.tag, (seen.get(k.tag) || 0) + 1);
    /* a list: several children of one tag, or a plural wrapper of one (DefinitionSources around one DefinitionSource) */
    const plural = (w, c) => { w = localOf(w).toLowerCase(); c = localOf(c).toLowerCase(); return w.endsWith(c + "s") || w.endsWith(c + "es") || (c.endsWith("y") && w.endsWith(c.slice(0, -1) + "ies")); };
    const isList = k => k.kids.length > 0 && k.kids.every(c => c.tag === k.kids[0].tag) && (k.kids.length > 1 || (k.kids[0].kids.length > 0 && plural(k.tag, k.kids[0].tag)));
    /* field names follow the display names, without the namespace prefix (scope, not S100FC:scope) */
    const keyName = r => names.custom.get(r.tag) || localOf(strippedName(r.tag));
    /* an element's value: its text, or else its attributes */
    const valueOf = el => el.textContent.trim() || [...el.attributes].filter(a => !/^xmlns(:|$)/.test(a.name)).map(a => a.name + "=" + a.value).join(" ");
    const out = [];
    for (const k of R0.kids) {
      if (k === nameRec) continue;
      if (seen.get(k.tag) > 1 || k.desc > 24 || isList(k)) break;
      if (!k.kids.length) { const v = valueOf(k.el); if (v) out.push({ key:keyName(k), value:v }); continue; }
      const items = [], st = [...k.kids].reverse();
      while (st.length) { const x = st.pop(); if (x.kids.length) { for (let i = x.kids.length - 1; i >= 0; i--) st.push(x.kids[i]); continue; } const v = valueOf(x.el); if (v) items.push({ key:keyName(x), value:v }); }
      if (items.length) out.push({ key:keyName(k), items });
    }
    return out;
  }

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
  ids.clear(); refAttrs.length = 0;

  /* ---------------- explanations ----------------
     Definitions come from dictionaries: the file's own (read the first time an explanation needs it: a catalogue explains
     itself), then the companion files the viewer opened, the one opened last first: it was opened for the file now
     shown, so it wins over one left open from an earlier file when both define a name. */
  const EX = XO.explain;
  let own = null, companions = [];
  function ownDict(){
    if (own) return own;
    own = EX.dictionary(doc, fileTitle);
    if (own.count) for (const r of E) { const e = own.byEl.get(r.el); if (e) e.rec = r; }
    return own;
  }
  const dicts = () => ownDict().count ? [own, ...companions] : companions;
  /* the entry for a code or name: as written first (NavigationLine is a feature type, navigationLine a role), then ignoring case */
  const lookupTerm = key => { for (const d of dicts()) { const e = EX.lookup(d, key); if (e) return e; } return null; };
  /* the entry for a tag, by its local name; once per tag, for all dictionaries and for the companions alone */
  const tagMemo = new Map(), tagMemoC = new Map();
  function entryForTag(tag, companionsOnly){
    const memo = companionsOnly ? tagMemoC : tagMemo;
    let e = memo.get(tag);
    if (e === undefined) { const key = localOf(tag); e = null; for (const d of companionsOnly ? companions : dicts()) { e = EX.lookup(d, key); if (e) break; } memo.set(tag, e); }
    return e;
  }
  /* inside one of the file's own definitions (the <name> of a catalogue's attribute, say), an element is part of that
     definition's structure: only a companion dictionary may explain its tag */
  const insideOwnEntry = r => { if (!ownDict().count) return false; for (let p = r.parent; p; p = p.parent) if (own.byEl.has(p.el)) return true; return false; };
  const tagEntry = r => entryForTag(r.tag, insideOwnEntry(r));
  /* the entry a reference attribute names, when its value is no id in this file: ref="beaconShape" → the beaconShape entry */
  function refEntryOf(r){
    const b = broken.get(r); if (!b) return null;
    for (const x of b) { const e = lookupTerm(x.v); if (e) return e; }
    return null;
  }
  /* an entry's listed values, or those of the type its `type` names in the same dictionary (an xs:element → its xs:simpleType) */
  function valuesOf(e){
    if (e.values) return e.values;
    const t = e.extra.type; if (!t) return null;
    const te = EX.lookup(e.dict, localOf(t));
    return te && te !== e && te.values || null;
  }
  /* Which listed value a short text is: of the entry for the element's tag, or else of one the element sits in: an ancestor's
     entry, or, when the element is itself a value (<value>, <enumeration>, a child of <permittedValues>), the entry a
     reference beside it names (a catalogue's permitted <value>s under an attribute binding). A bound (<lower>, <upper>,
     minOccurs …) is a count, never one of the values. { entry, value } with value null when the text is none of the listed
     values; null when no list applies. */
  const BOUND_TAG = /^(lower|upper|multiplicity|minoccurs|maxoccurs|min|max)$/i;
  const valueLike = r => EX.isValue(r.el.localName) || (r.parent && /values$/i.test(r.parent.el.localName));
  function valueFor(r){
    if (r.kids.length || BOUND_TAG.test(r.el.localName)) return null;
    const t = r.el.textContent.trim(); if (!t || t.length > 80) return null;
    let e = tagEntry(r), vals = e && valuesOf(e);
    if (!vals) {
      e = null;
      const besideRef = valueLike(r);
      for (let anc = r.parent, n = 0; anc && n < 2 && !vals; anc = anc.parent, n++) {
        const a = tagEntry(anc); if (a && (vals = valuesOf(a))) { e = a; break; }
        if (besideRef) for (let i = 0; i < anc.kids.length && i < 64; i++) { const c = refEntryOf(anc.kids[i]); if (c && (vals = valuesOf(c))) { e = c; break; } }
      }
    }
    if (!vals) return null;
    const q = t.toLowerCase(), by = f => vals.find(v => String(f(v) ?? "").toLowerCase() === q);
    return { entry:e, value:by(v => v.code) || by(v => v.term) || by(v => v.name) || null };
  }
  /* the URL(s) of the XML Schema the root says defines its names */
  function schemaUrls(el){
    let out = "";
    if (el.hasAttributes()) for (const a of el.attributes) {
      if (a.localName === "noNamespaceSchemaLocation") out = a.value.trim();
      else if (a.localName === "schemaLocation") out = a.value.trim().split(/\s+/).filter((_, i) => i % 2 === 1).join(", ");
    }
    return out || null;
  }
  /* what the side panel shows of an entry; `defines`: the element is the definition itself; `id`: the defining element,
     when it is in this file and is another element */
  const defOf = (e, r, defines) => ({ name:e.name, code:e.code, kind:e.kind, text:e.def, remarks:e.remarks, aliases:e.aliases, extra:e.extra, from:e.dict.title,
    id:e.rec && e.rec !== r ? id(e.rec) : null, defines, parentName:e.parent ? e.parent.name : null, parentId:e.parent && e.parent.rec ? id(e.parent.rec) : null, values:e.values ? e.values.length : 0 });
  /* explanations are kept per element while the file is shown; they go when the dictionaries or the display names change */
  const explainMemo = new Map();
  let memoNames = names.version;
  function explainOf(r){
    const el = r.el, kids = r.kids, n = kids.length, dictionaries = dicts();
    const direct = directText(el), sents = [];
    let schemaHint = null;
    const ownE = ownDict().count ? own.byEl.get(el) : null;
    if (r.depth === 0) {
      sents.push(`The root element: everything in the file is inside it. It has ${EX.count(n, "child element")} of ${EX.count(new Set(kids.map(k => k.tag)).size, "kind")}.`);
      /* the most numerous kinds, up to KINDS_SHOWN: a file with a kind per term would list thousands */
      if (own.count) { const ks = [...own.kinds].sort((a, b) => b[1] - a[1]); sents.push(`This file is a dictionary: it defines ${EX.count(own.count, "term")} (${ks.slice(0, KINDS_SHOWN).map(([k, c]) => EX.count(c, k)).join(", ")}${ks.length > KINDS_SHOWN ? ", …" : ""}).`); }
      if (companions.length) sents.push(`Explained with: ${companions.map(d => d.title).join(", ")}.`);
      schemaHint = schemaUrls(el);
      if (schemaHint) sents.push(`It says its names are defined by the schema at ${schemaHint}. Open that .xsd file as a dictionary to see their definitions.`);
    } else {
      const refs = el.hasAttributes() ? [...el.attributes].filter(a => kindOf(a.name) === 2) : [];
      if (n >= 2 && kids.every(k => k.tag === kids[0].tag)) sents.push(`A list of ${n} <${dn(kids[0].tag)}> elements${kids.every(k => idOf(k)) ? ", each with its own id" : ""}.${direct ? " It also holds text." : ""}`);
      else if (n === 1) sents.push(`A container with one part: <${dn(kids[0].tag)}>.${direct ? " It also holds text." : ""}`);
      else if (n) { const tagsIn = [...new Set(kids.map(k => k.tag))]; sents.push(`A container with ${n} parts: ${tagsIn.slice(0, 5).map(t => "<" + dn(t) + ">").join(", ")}${tagsIn.length > 5 ? ", …" : ""}.${direct ? " It also holds text." : ""}`); }
      else if (!direct && refs.length) {
        const to = out.get(r), e = to ? null : refEntryOf(r), v = refs[0].value.replace(/^#/, "");
        if (to) sents.push(`A link: it points at ${labelOf(to[0].to)}${to.length > 1 ? ` (and ${EX.count(to.length - 1, "other")})` : ""} instead of holding data of its own.`);
        else if (e) sents.push(`A link to “${clip(v, 60)}”: the ${e.kind} “${e.name}”, defined ${e.dict === own ? "in this file" : "in " + e.dict.title}.`);
        else sents.push(`A link to “${clip(v, 60)}”, which is not in this file.`);
      }
      else if (direct) { const tw = typeWord(direct); sents.push(`A field: holds the value “${clip(direct, 80)}”${tw ? ", " + tw : ""}.`); }
      else if (el.attributes.length) sents.push("Holds no text and no child elements; its attributes carry the data.");
      else sents.push("An empty element: no text, no attributes and no child elements.");
      /* who it is: its name (a name-like child, else its name attribute; the definition block says it when the element is a
         definition) and its id */
      const nm = ownE ? "" : (n ? nameOf(r) : "") || el.getAttribute("name") || "", idv = idOf(r), pointers = (inn.get(r) || []).length, bits = [];
      if (nm) bits.push(`Its name is “${clip(nm, 60)}”`);
      if (idv) bits.push(`${nm ? "its" : "Its"} id is “${clip(idv, 60)}”`);
      if (bits.length) sents.push(bits.join(" and ") + (idv && pointers ? `; ${EX.count(pointers, "other element")} point${pointers === 1 ? "s" : ""} at it` : "") + ".");
      /* its place among siblings of the same tag */
      const p = r.parent; countSiblings(p);
      const same = p.same.get(r.tag);
      if (same > 1) sents.push(`It is the ${ordinal(r.nth)} of ${same} <${dn(r.tag)}> elements in <${dn(p.tag)}>.`);
    }
    /* what defines it: the element is a definition itself, or a reference to one, or its tag is defined */
    let def = null;
    if (ownE) def = defOf(ownE, r, true);
    else { const e = refEntryOf(r) || tagEntry(r); if (e) def = defOf(e, r, false); }
    const vf = valueFor(r), v = vf && vf.value, vals = vf && valuesOf(vf.entry);
    const value = vf ? { label:v ? v.name : null, code:v ? v.code : null, text:v ? v.def : null, from:vf.entry.dict.title, listName:vf.entry.name,
      listId:vf.entry.rec && vf.entry.rec !== r ? id(vf.entry.rec) : null, total:vals.length,
      /* when the text is none of them: the first listed values, each with the start of its meaning when that is not just its name */
      allowed:v ? null : vals.slice(0, 12).map(x => x.name + (x.def && x.def !== x.name ? " (" + clip(EX.firstSentence(x.def), 60) + ")" : "")) } : null;
    const g = EX.glossary(r.tag), attrs = new Map();
    if (el.hasAttributes()) for (const a of el.attributes) {
      let t = EX.glossary(a.name);
      if (!t) { const e = lookupTerm(localOf(a.name)); if (e && e.kind === "attribute" && e.def) t = e.def; }
      if (t) attrs.set(a.name, t);
    }
    /* what: plain words; def: what defines the name; value: the listed value its text is; glossary: for its own tag; attrs: per
       attribute name; schemaHint: the schema URL the root names; dictionaries: the companion titles, for the no-definition line */
    return { what:sents.join(" "), def, value, glossary:g ? [{ name:r.tag, text:g }] : [], attrs, schemaHint, dictionaries:dictionaries.filter(d => d !== own).map(d => d.title) };
  }
  const directText = el => [...el.childNodes].filter(n => n.nodeType === 3 || n.nodeType === 4).map(n => n.nodeValue).join("").trim();

  /* Search: an element matches when its tag, its display name, its key, its name or an attribute value (or, for the root,
     the file's name) holds the query, ignoring case; the first 40 in document order are shown. Tags and their display
     names are checked once per tag, so names the viewer changes are found at once; a tag also matches when a dictionary's
     name or alias for it holds the query, or every word of it ("lateral buoy" and "BOYLAT" find <BuoyLateral>). The rest of an element's text is lower-cased the
     first time a search reaches it and kept, up to INDEX_MAX characters in all; elements past that are read from the
     document each time, so a file of huge texts cannot use up memory. XML can never hold the
     character \0, so it parts the fields: no match runs from one into the next, and lower-casing them together is the same
     as one by one. */
  const INDEX_MAX = 8e6, hay = [];
  let hayLen = 0;
  function textOf(r){
    const h = hay[r.i];
    if (h !== undefined || hayLen >= INDEX_MAX) return h ?? null;
    const el = r.el;
    let s = keyOf(r);
    const nm = nameOf(r); if (nm && nm !== s) s += "\0" + nm;
    if (el.hasAttributes()) for (const n of el.getAttributeNames()) s += "\0" + el.getAttribute(n);
    if (r.depth === 0) s += "\0" + fileTitle;
    if ((hayLen += s.length) > INDEX_MAX) return null;
    return hay[r.i] = s.toLowerCase();
  }
  function textHas(r, q){
    const h = textOf(r);
    if (h !== null) return h.includes(q);
    if (keyOf(r).toLowerCase().includes(q) || nameOf(r).toLowerCase().includes(q) || (r.depth === 0 && fileTitle.toLowerCase().includes(q))) return true;
    const el = r.el;
    if (el.hasAttributes()) for (const n of el.getAttributeNames()) if (el.getAttribute(n).toLowerCase().includes(q)) return true;
    return false;
  }

  /* for xpath(): each element's place among its same-tag siblings, and how many share its tag, counted once per parent
     the first time one of its children needs a path (a parent can have thousands of children) */
  function countSiblings(p){
    if (p.same) return;
    p.same = new Map();
    for (const k of p.kids) { const n = (p.same.get(k.tag) || 0) + 1; p.same.set(k.tag, n); k.nth = n; }
  }

  /* Size on a 1–100 scale of direct children: the element with the most children in this file is 100,
     an element with none is 1. The same scale holds at every depth. */
  let maxKids = 1; for (const r of E) if (r.kids.length > maxKids) maxKids = r.kids.length;
  const score = r => Math.round(1 + 99 * r.kids.length / maxKids);
  const size = r => 3 + 25 * (score(r) - 1) / 99;
  return {
    palette, total:E.length, rootId:id(E[0]), title:fileTitle, header,
    tagOf: x => rec(x)?.tag || "",
    node(x){ const r = rec(x); return r && { id:x, label:labelOf(r), color:"t:" + r.tag, size:size(r), kind:"<" + dn(r.tag) + ">", kids:r.kids.length }; },
    canOpen: x => { const r = rec(x); return !!r && r.kids.length > 0; },
    groups(x){
      const r = rec(x); if (!r) return [];
      const by = new Map();
      for (const k of r.kids) { let l = by.get(k.tag); if (!l) by.set(k.tag, l = []); l.push(k); }
      return [...by].map(([tag, ks]) => ({ key:"t:" + tag, title:"<" + dn(tag) + ">", color:"t:" + tag,
        entries:ks.map(k => ({ id:id(k) })) }));
    },
    refs(x){ const r = rec(x); return (out.get(r) || []).map(o => ({ to:id(o.to), color:"ref", short:"@" + o.attr })); },
    pathTo(x){ const c = []; for (let r = rec(x); r; r = r.parent) c.unshift(id(r)); return c; },
    search(q){
      q = q.trim().toLowerCase(); if (!q) return [];
      /* the tags whose own name or display name holds the query */
      const tagHit = new Map(), words = q.split(/\s+/).filter(Boolean);
      const nameHit = t => { const e = entryForTag(t, false); return !!e && [e.name, ...e.aliases].some(s => { s = s.toLowerCase(); return s.includes(q) || words.every(w => s.includes(w)); }); };
      for (const t of tags) tagHit.set(t, t.toLowerCase().includes(q) || dn(t).toLowerCase().includes(q) || nameHit(t));
      const text = !q.includes("\0"), res = [];
      for (let i = 0; i < E.length && res.length < 40; i++) { const r = E[i]; if (tagHit.get(r.tag) || (text && textHas(r, q))) res.push(r); }
      /* d: what the tag's dictionary entry calls it, and the first sentence of its definition */
      return res.map(r => { const e = tagEntry(r); return { id:id(r), label:labelOf(r), sub:xpath(r), d:e ? e.name + (e.def ? ": " + EX.firstSentence(e.def) : "") : "" }; });
    },
    explain(x){
      const r = rec(x); if (!r) return null;
      if (memoNames !== names.version) { explainMemo.clear(); memoNames = names.version; }
      let m = explainMemo.get(r.i);
      if (!m) explainMemo.set(r.i, m = explainOf(r));
      return m;
    },
    /* the companion dictionaries, the one opened last first (see the note above); explanations are worked out afresh */
    setDictionaries(list){ companions = [...list].reverse(); tagMemo.clear(); tagMemoC.clear(); explainMemo.clear(); },
    info(x){
      const r = rec(x); if (!r) return null;
      const direct = directText(r.el);
      const kidTags = new Map(); for (const k of r.kids) kidTags.set(k.tag, (kidTags.get(k.tag) || 0) + 1);
      /* a reference that is no id in this file may name a defined term: a link to the definition when that is in this
         file, a plain row when it is in a companion dictionary, a broken reference otherwise */
      const linksOut = (out.get(r) || []).map(o => ({ id:id(o.to), text:"@" + o.attr + " → " + labelOf(o.to), color:"ref" })), defined = [], brokenRows = [];
      for (const b of broken.get(r) || []) {
        const e = lookupTerm(b.v);
        if (!e) brokenRows.push("@" + b.attr + " → " + b.v + " (not found in this file)");
        else if (e.rec) linksOut.push({ id:id(e.rec), text:"@" + b.attr + " → " + e.name + " (defined in this file)", color:"ref" });
        else defined.push("@" + b.attr + " → " + e.name + " (in " + e.dict.title + ")");
      }
      return {
        kind:"Element <" + dn(r.tag) + ">" + (r.depth === 0 ? " · the root element" : ""), title:r.depth === 0 ? labelOf(r) : keyOf(r) || dn(r.tag), code:xpath(r), tag:r.tag,
        header:r.depth === 0 ? header() : null,
        def: direct ? clip(direct, 600) : "",
        attrs:[...r.el.attributes].map(a => [a.name, a.value]),
        facts:["size " + score(r) + " of 100", r.kids.length ? r.kids.length + " child element" + (r.kids.length === 1 ? "" : "s") : "no child elements", r.desc > r.kids.length ? r.desc + " elements inside in all" : "", r.el.namespaceURI ? "ns " + r.el.namespaceURI : ""].filter(Boolean),
        orbits:[...kidTags].map(([t, n]) => ({ color:"t:" + t, title:"<" + dn(t) + ">", count:n })),
        linksOut, defined,
        linksIn:(inn.get(r) || []).map(o => ({ id:id(o.from), text:labelOf(o.from) + " @" + o.attr, color:"ref" })),
        broken:brokenRows
      };
    }
  };
  function xpath(r){
    const parts = [];
    for (let x = r; x; x = x.parent) {
      const p = x.parent; if (p) countSiblings(p);
      parts.unshift(dn(x.tag) + (p && p.same.get(x.tag) > 1 ? "[" + x.nth + "]" : ""));
    }
    return "/" + parts.join("/");
  }
}

XO.sources = { xmlSource, titleOf, inkFor };
})();
