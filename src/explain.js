/* Explanations: plain-words helpers, a small glossary of universal XML names, and dictionaries: definitions read out of
   any XML document (a feature catalogue, an XML Schema, or the open file itself). sources.js uses them to explain each
   element. Nothing here reads the network: a dictionary is a file the viewer opened. */
(function(){
"use strict";
const XO = window.XO = window.XO || {};
const lower = s => String(s ?? "").toLowerCase();
const text = el => el.textContent.trim();

/* "S100_FC_SimpleAttribute" → "simple attribute", "listedValue" → "listed value", "complexType" → "complex type":
   leading all-capital parts ending in _ go, the rest is split at capitals and underscores and lower-cased */
function humanize(local){
  let s = local.replace(/^(?:[A-Z0-9]+_)+/, "") || local;
  s = s.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
/* "simple attribute" → "simple attributes", "entry" → "entries" */
function plural(noun, n){
  if (n === 1) return noun;
  if (/[sxz]$|[cs]h$/.test(noun)) return noun + "es";
  if (/[^aeiou]y$/.test(noun)) return noun.slice(0, -1) + "ies";
  return noun + "s";
}
const count = (n, noun) => n.toLocaleString() + " " + plural(noun, n);
/* the first sentence of a text; the whole text when it has no sentence end, or a very short first one (an abbreviation) */
function firstSentence(t){
  t = String(t ?? "").replace(/\s+/g, " ").trim();
  const m = /^.*?[.!?](?=["”')\]]?(?:\s|$))/.exec(t);
  return m && m[0].length >= 12 ? m[0] : t;
}

/* ---------------- glossary: universal XML, XLink and GML names, in plain words ----------------
   Keyed by prefix and local name; a name in a file's own vocabulary is never guessed at (that is what dictionaries are for). */
const PREFIXED = {
  "xsi:schemalocation":"Where the XML Schema (.xsd) that defines this file's names can be found: pairs of namespace and URL.",
  "xsi:nonamespaceschemalocation":"The URL of the XML Schema (.xsd) that defines this file's names.",
  "xsi:type":"The exact type of this element, when the schema allows several.",
  "xsi:nil":"true means this element is deliberately empty: it has no value.",
  "xml:lang":"The language of the text, as a code such as en or fr.",
  "xml:id":"This element's unique id. Other elements point at it with #id.",
  "xlink:href":"A link: #id points at the element with that id in this file; a URL points outside it.",
  "xlink:type":"The kind of XLink link; simple is the usual.",
  "xlink:title":"A human-readable title for the link.",
  "xlink:role":"What the link means, as a URI.",
  "xlink:arcrole":"What the link means, as a URI.",
  "gml:id":"This element's unique id. Other elements point at it with #id.",
  "gml:pos":"One position: its coordinates in the order the reference system defines (for EPSG 4326, latitude then longitude).",
  "gml:poslist":"A run of positions: coordinates one after another.",
  "gml:point":"A single position.",
  "gml:linestring":"A line through its positions.",
  "gml:curve":"A line through its positions.",
  "gml:polygon":"An area bounded by its ring(s).",
  "gml:surface":"An area bounded by its ring(s).",
  "gml:envelope":"The bounding box of the data.",
  "gml:boundedby":"The bounding box of the data.",
  "gml:name":"A name of this object.",
  "gml:description":"A description of this object.",
  "gml:identifier":"The object's identifier."
};
/* names that mean the same whatever their prefix */
const ANY_PREFIX = {
  id:"This element's unique id. Other elements point at it with #id.",
  href:"A link: #id points at the element with that id in this file; a URL points outside it.",
  ref:"Points at another element by its id or code.", idref:"Points at another element by its id or code.",
  idrefs:"Points at other elements by their ids or codes.", refid:"Points at another element by its id or code.",
  srsname:"The coordinate reference system of the coordinates, as a URI; EPSG 4326 is WGS 84 latitude and longitude.",
  srsdimension:"How many numbers make up one position (2 or 3).",
  uom:"The unit of measure of the value.",
  codespace:"The code list the value comes from."
};
/* the glossary text for a tag or attribute name (with its prefix, as written in the file), or null */
function glossary(name){
  if (!name) return null;
  const i = name.indexOf(":"), prefix = i < 0 ? "" : lower(name.slice(0, i)), local = name.slice(i + 1);
  if (name === "xmlns") return "Declares the default namespace: the vocabulary that unprefixed tags in this part of the file belong to.";
  if (prefix === "xmlns") return `Declares the prefix ${local}: tags and attributes written ${local}:… belong to this namespace.`;
  return PREFIXED[prefix + ":" + lower(local)] || ANY_PREFIX[lower(local)] || null;
}

/* ---------------- dictionaries: definitions found in any XML ----------------
   A defined item is an element with a term (a code or name) and a definition (a child, or a grandchild through one wrapper
   such as xs:annotation, whose name says it is one), or with a term and values that have definitions (an xs:simpleType
   whose xs:enumerations are documented). Values (listed values, enumerations) nested in a defined item belong to it. Items
   whose definition is empty or "." are kept: the dictionary then says that no definition is given. The root element is never
   an item: it is the file, and its definitions are read from the elements below it. */
const DEF_TAGS = new Set(["definition", "description", "documentation", "remarks", "abstract", "summary", "comment", "note", "doc", "desc", "help", "explanation"]);
/* which definition wins when an item has several */
const DEF_RANK = new Map(["definition", "documentation", "description", "abstract", "summary", "explanation", "doc", "desc", "help", "comment", "note"].map((t, i) => [t, i]));
/* text-only children that describe an item (its value type, unit, multiplicity …), kept as extra facts; such an element
   describes its parent and is never an item itself */
const INFO_TAGS = new Set(["valuetype", "datatype", "type", "uom", "unit", "symbol", "featureusetype", "multiplicity", "default", "fixed", "use", "minoccurs", "maxoccurs", "nillable", "supertype"]);
const INFO_ATTRS = new Set(["type", "use", "default", "fixed", "minoccurs", "maxoccurs", "nillable", "abstract", "isabstract"]);
/* an item of one of these kinds inside another item is one of its values */
const VALUE_TAG = /^(listedvalue|enumeration|enum|value|option|codelistvalue|literal|constant)$/;
const isValue = local => VALUE_TAG.test(lower(local));
/* text-only children and attributes that give an element a term of its own */
const TERM_TAGS = new Set(["code", "name", "label", "title", "identifier", "key", "term"]);
const TERM_ATTRS = new Set(["name", "code", "id", "value"]);
/* whether an element has a term of its own: such an element is an item or a value, never a wrapper that lends its
   definition to its parent */
function hasTerm(el){
  if (el.hasAttributes()) for (const a of el.attributes) if (TERM_ATTRS.has(lower(a.localName))) return true;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (!c.firstElementChild && TERM_TAGS.has(lower(c.localName)) && text(c)) return true;
  return false;
}
/* whether an element has a definition: a child, or a grandchild through one wrapper, named for one */
function hasDefIn(el){
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (DEF_TAGS.has(lower(c.localName))) return true;
    for (let g = c.firstElementChild; g; g = g.nextElementSibling) if (DEF_TAGS.has(lower(g.localName))) return true;
  }
  return false;
}

/* the item an element defines, or null */
function itemOf(el){
  const ln0 = lower(el.localName);
  if (INFO_TAGS.has(ln0)) return null;
  let code = null, name = null, label = null, title = null, ident = null, key = null, aliases = null, def = null, rank = 99, remarks = null, extra = null, hasDef = false, hasWrap = false, hasValues = false;
  const takeDef = c => {
    const ln = lower(c.localName), t = text(c);
    hasDef = true;
    if (ln === "remarks") { if (remarks === null && t) remarks = t; return; }
    const k = DEF_RANK.get(ln); if (k < rank && t) { rank = k; def = t; }
  };
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    const ln = lower(c.localName);
    if (DEF_TAGS.has(ln)) { takeDef(c); continue; }
    if (c.firstElementChild) {
      if (ln === "uom") { let un = "", sym = ""; for (let g = c.firstElementChild; g; g = g.nextElementSibling) { const gl = lower(g.localName); if (gl === "name") un = text(g); else if (gl === "symbol") sym = text(g); } if (un || sym) (extra || (extra = {})).unit = un && sym ? `${un} (${sym})` : un || sym; }
      else if (VALUE_TAG.test(ln)) { if (!hasValues) hasValues = hasDefIn(c); }
      else hasWrap = true;
      continue;
    }
    switch (ln) {
      case "code": if (code === null) code = text(c); break;
      case "name": if (name === null) name = text(c); break;
      case "label": if (label === null) label = text(c); break;
      case "title": if (title === null) title = text(c); break;
      case "identifier": if (ident === null) ident = text(c); break;
      case "alias": { const t = text(c); if (t) (aliases || (aliases = [])).push(t); break; }
      case "key": case "term": if (key === null) key = text(c); break;
      default: if (INFO_TAGS.has(ln)) { const t = text(c); if (t) (extra || (extra = {}))[c.localName] = t; }
    }
  }
  /* no definition of its own: one wrapper down (xs:annotation > xs:documentation), or defined values one wrapper down
     (xs:restriction > xs:enumeration). A child with a term of its own is an item, not a wrapper: nothing is taken through it. */
  if (!hasDef && hasWrap) for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (!c.firstElementChild || hasTerm(c)) continue;
    for (let g = c.firstElementChild; g; g = g.nextElementSibling) {
      const gl = lower(g.localName);
      if (DEF_TAGS.has(gl)) takeDef(g);
      else if (!hasValues && VALUE_TAG.test(gl) && g.firstElementChild) hasValues = hasDefIn(g);
    }
  }
  if (!hasDef && !hasValues) return null;
  let aName = null, aCode = null, aId = null, aValue = null;
  if (el.hasAttributes()) for (const a of el.attributes) {
    const ln = lower(a.localName);
    if (ln === "name") aName = a.value; else if (ln === "code") aCode = a.value; else if (ln === "id") aId = a.value; else if (ln === "value") aValue = a.value;
    else if (INFO_ATTRS.has(ln)) (extra || (extra = {}))[a.localName] = a.value;
  }
  const term = code || aName || aCode || name || ident || label || aId || key || aValue || title;
  if (!term) return null;
  return { term, code:code || aCode || aValue || null, name:name || label || title || aName || term, aliases:aliases || [], def:def && def !== "." ? def : null, remarks,
    kind:humanize(el.localName), values:null, parent:null, extra:extra || {}, dict:null, rec:null };
}

/* All the terms a document defines: { title, exact, terms, byEl, count, kinds }. `exact` maps codes and terms as written
   to top-level entries, so NavigationLine (a feature type) and navigationLine (a role) stay apart; `terms` maps lower-cased
   codes, terms, names and aliases to them (in both, the first key written wins, so a code is never covered by another
   entry's name). `byEl` maps every defining element, values included, to its entry (`rec`, the element's record, is filled
   in by sources.js for the open file's own dictionary); `kinds` counts the top-level entries per kind. One walk in document
   order, without a stack: `up` is the chain of open ancestors, let go as the walk leaves them, so nothing is kept for
   elements that define nothing. */
function dictionary(doc, title){
  const D = { title, exact:new Map(), terms:new Map(), byEl:new Map(), count:0, kinds:new Map() };
  const put = (key, e) => { key = lower(key).trim(); if (key && !D.terms.has(key)) D.terms.set(key, e); };
  const putExact = (key, e) => { key = String(key).trim(); if (key && !D.exact.has(key)) D.exact.set(key, e); };
  for (let el = doc.documentElement, up = null; el; ) {
    const e = up ? itemOf(el) : null;
    if (e) {
      e.dict = D; D.byEl.set(el, e);
      /* a value of the item one or two levels up (through a wrapper such as listedValues or xs:restriction) */
      const p = up && (up.entry || up.parent?.entry);
      if (p && VALUE_TAG.test(lower(el.localName))) { (p.values || (p.values = [])).push(e); e.parent = p; }
      else {
        D.count++; D.kinds.set(e.kind, (D.kinds.get(e.kind) || 0) + 1);
        if (e.code) { putExact(e.code, e); put(e.code, e); }
        putExact(e.term, e); put(e.term, e); put(e.name, e);
        for (const a of e.aliases) put(a, e);
      }
    }
    if (el.firstElementChild) { up = { el, parent:up, entry:e }; el = el.firstElementChild; continue; }
    while (!(el = el.nextElementSibling) && up) { el = up.el; up = up.parent; }
  }
  return D;
}

/* the entry a dictionary has for a code or tag name: as written first, then ignoring case */
const lookup = (d, key) => d.exact.get(key) || d.terms.get(lower(key)) || null;

XO.explain = { glossary, dictionary, lookup, isValue, firstSentence, count };
})();
