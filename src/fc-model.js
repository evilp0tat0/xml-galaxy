/* S-100 Feature Catalogue support: reads the catalogue XML and answers "what links to what" by meaning
   (inheritance, feature and information links, attributes, allowed values), not by XML nesting. */
(function(){
"use strict";
const KIND = {
  ft:{one:"Feature type",tags:["S100_FC_FeatureType"]},
  it:{one:"Information type",tags:["S100_FC_InformationType"]},
  fa:{one:"Feature association",tags:["S100_FC_FeatureAssociation"]},
  ia:{one:"Information association",tags:["S100_FC_InformationAssociation"]},
  ro:{one:"Role",tags:["S100_FC_Role"]},
  ca:{one:"Complex attribute",tags:["S100_FC_ComplexAttribute"]},
  sa:{one:"Simple attribute",tags:["S100_FC_SimpleAttribute"]}
};
const ORDER = ["ft","it","fa","ia","ro","ca","sa"];
const XSI = "http://www.w3.org/2001/XMLSchema-instance";
const keyOf = it => it.kind + ":" + it.code;
const state = { inherited: true };
/* ---------- XML helpers (namespace-agnostic: match by local name) ---------- */
const kids = (el, n) => el ? [...el.children].filter(c => c.localName === n) : [];
const kid = (el, n) => kids(el, n)[0] || null;
const txt = (el, n) => { const k = kid(el, n); return k ? k.textContent.trim() : ""; };
const refOf = (el, n) => { const k = kid(el, n); return k ? (k.getAttribute("ref") || k.textContent || "").trim() : ""; };
const texts = (el, n) => kids(el, n).map(k => k.textContent.trim()).filter(Boolean);

function mult(el){
  const m = kid(el, "multiplicity");
  if (!m) return null;
  const lo = txt(m, "lower") || "0";
  const u = kid(m, "upper");
  let up;
  if (!u) up = "?";
  else if (u.getAttribute("infinite") === "true") up = "*";
  else if (!u.textContent.trim() && (u.getAttributeNS(XSI, "nil") === "true" || u.getAttribute("xsi:nil") === "true")) up = "*";
  else up = u.textContent.trim() || "*";
  return { lo, up, text: lo === up ? lo : lo + ".." + up, required: lo !== "0" };
}

function decode(buf){
  const u = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  if (u[0] === 0xFF && u[1] === 0xFE) return new TextDecoder("utf-16le").decode(buf);
  if (u[0] === 0xFE && u[1] === 0xFF) return new TextDecoder("utf-16be").decode(buf);
  if (u[0] === 0x3C && u[1] === 0) return new TextDecoder("utf-16le").decode(buf);
  if (u[0] === 0 && u[1] === 0x3C) return new TextDecoder("utf-16be").decode(buf);
  /* Valid UTF-8 wins even when the declaration says otherwise: catalogues are often mislabelled. */
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch {}
  const head = new TextDecoder("latin1").decode(new Uint8Array(buf.slice(0, 300)));
  const m = /encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head);
  try { return new TextDecoder(m ? m[1] : "windows-1252").decode(buf); } catch { return new TextDecoder("utf-8").decode(buf); }
}

/* ---------- parse ---------- */
function parseFC(text, source){
  const doc = typeof text === "string" ? new DOMParser().parseFromString(text, "application/xml") : text;
  const perr = doc.getElementsByTagName("parsererror")[0];
  if (perr) throw new Error("The file is not well-formed XML. " + ((perr.querySelector("div") || perr).textContent || "").trim().slice(0, 240));
  const root = doc.documentElement;
  if (root.localName !== "S100_FC_FeatureCatalogue") throw new Error("This file is not an S-100 Feature Catalogue: its root element is <" + root.localName + ">, expected <S100_FC_FeatureCatalogue>.");

  const org = root.getElementsByTagNameNS("*", "CI_Organisation")[0];
  const meta = {
    name: txt(root, "name"), scope: txt(root, "scope"), field: txt(root, "fieldOfApplication"),
    version: txt(root, "versionNumber"), date: txt(root, "versionDate"), product: txt(root, "productId"),
    producer: org ? txt(org, "name") : "", ns: root.namespaceURI || "", source
  };

  const defSrc = new Map();
  for (const tag of ["FC_DefinitionSource", "S100_FC_DefinitionSource"])
    for (const d of root.getElementsByTagNameNS("*", tag)) {
      const t = d.getElementsByTagNameNS("*", "title")[0];
      defSrc.set(d.getAttribute("id") || "", t ? t.textContent.trim() : "");
    }
  const defRef = e => {
    const r = kid(e, "definitionReference"); if (!r) return null;
    const src = refOf(r, "definitionSource");
    return { id: txt(r, "sourceIdentifier"), src, title: defSrc.get(src) || "" };
  };
  const bindings = (e, tag, targetTag) => kids(e, tag).map(b => ({
    mult: mult(b), seq: b.getAttribute("sequential") === "true", roleType: b.getAttribute("roleType") || "",
    ref: refOf(b, targetTag), assoc: refOf(b, "association"), role: refOf(b, "role"),
    permitted: texts(kid(b, "permittedValues"), "value")
  }));

  const items = [], checks = [];
  for (const kind of ORDER) for (const tag of KIND[kind].tags) for (const e of root.getElementsByTagNameNS("*", tag)) {
    const it = {
      kind, code: txt(e, "code"), name: txt(e, "name"), def: txt(e, "definition"),
      remarks: texts(e, "remarks"), alias: texts(e, "alias"), abstract: e.getAttribute("isAbstract") === "true",
      defRef: defRef(e), sup: refOf(e, "superType")
    };
    if (!it.code) { checks.push({ text: KIND[kind].one + " “" + (it.name || "unnamed") + "” has no code." }); continue; }
    if (kind === "ft" || kind === "it") {
      it.attrs = bindings(e, "attributeBinding", "attribute");
      it.fbind = kind === "ft" ? bindings(e, "featureBinding", "featureType") : [];
      it.ibind = bindings(e, "informationBinding", "informationType");
      it.useType = txt(e, "featureUseType");
      it.prims = texts(e, "permittedPrimitives");
    }
    if (kind === "fa" || kind === "ia") it.attrs = bindings(e, "attributeBinding", "attribute");
    if (kind === "fa" || kind === "ia") it.roles = kids(e, "role").map(r => (r.getAttribute("ref") || r.textContent).trim()).filter(Boolean);
    if (kind === "ca") it.subs = bindings(e, "subAttributeBinding", "attribute");
    if (kind === "sa") {
      it.valueType = txt(e, "valueType");
      it.values = kids(kid(e, "listedValues"), "listedValue").map(v => ({
        code: txt(v, "code"), label: txt(v, "label"), def: txt(v, "definition"), remarks: txt(v, "remarks"), alias: texts(v, "alias")
      }));
      it.quantity = txt(e, "quantitySpecification");
      const u = kid(e, "uom");
      it.uom = u ? [txt(u, "name"), txt(u, "symbol") && "(" + txt(u, "symbol") + ")"].filter(Boolean).join(" ") : "";
      const c = kid(e, "constraints"), cons = [];
      if (c) for (const ch of c.children) {
        if (ch.localName === "range") {
          const lo = txt(ch, "lowerBound"), hi = txt(ch, "upperBound"), cl = txt(ch, "closure");
          cons.push(["Range", (lo || "−∞") + " to " + (hi || "∞") + (cl ? " (" + cl + ")" : "")]);
        } else cons.push([ch.localName.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase()), ch.textContent.trim()]);
      }
      it.cons = cons;
    }
    items.push(it);
  }

  const by = new Map();
  for (const it of items) {
    const k = keyOf(it);
    if (by.has(k)) checks.push({ text: KIND[it.kind].one + " code “" + it.code + "” is defined twice; the first one is shown." });
    else by.set(k, it);
  }
  const find = (kinds, code) => { if (!code) return null; for (const k of kinds) { const x = by.get(k + ":" + code); if (x) return x; } return null; };
  const miss = (from, what, ref) => checks.push({ from, text: what + " “" + ref + "” is not defined in the catalogue." });

  for (const it of by.values()) {
    it.subtypes = []; it.incoming = []; it.usedBy = [];
  }
  for (const it of by.values()) {
    if (it.sup) { it.supItem = find([it.kind], it.sup); if (it.supItem) it.supItem.subtypes.push(it); else miss(it, "Supertype", it.sup); }
    if (it.attrs) for (const b of it.attrs) { b.item = find(["sa","ca"], b.ref); if (b.item) b.item.usedBy.push({ from: it, b }); else miss(it, "Attribute", b.ref); }
    if (it.subs) for (const b of it.subs) { b.item = find(["sa","ca"], b.ref); if (b.item) b.item.usedBy.push({ from: it, b }); else miss(it, "Sub-attribute", b.ref); }
    for (const [list, tKind, aKinds, label] of [[it.fbind, "ft", ["fa","ia"], "Feature type"], [it.ibind, "it", ["ia","fa"], "Information type"]]) {
      if (!list) continue;
      for (const b of list) {
        b.item = find([tKind], b.ref); b.assocItem = find(aKinds, b.assoc); b.roleItem = find(["ro"], b.role);
        b.kind = tKind === "ft" ? "feature" : "information";
        if (b.item) b.item.incoming.push({ from: it, b }); else if (b.ref) miss(it, label, b.ref);
        if (b.assocItem) b.assocItem.usedBy.push({ from: it, b }); else if (b.assoc) miss(it, "Association", b.assoc);
        if (b.roleItem) b.roleItem.usedBy.push({ from: it, b }); else if (b.role) miss(it, "Role", b.role);
      }
    }
    if (it.roles) {
      it.roleItems = it.roles.map(r => { const x = find(["ro"], r); if (x) { x.inAssoc ||= []; if (!x.inAssoc.includes(it)) x.inAssoc.push(it); } else miss(it, "Role", r); return x || { missing: true, code: r }; });
    }
  }
  for (const it of by.values()) if (it.kind === "ro") it.inAssoc ||= [];
  return { meta, items: [...by.values()], by, checks, find };
}

/* ---------- graph helpers ---------- */
function chain(it){
  const out = []; const seen = new Set(); let cur = it;
  while (cur && !seen.has(cur)) { out.push(cur); seen.add(cur); cur = cur.supItem; }
  return out;
}
/* Own bindings first, then each ancestor's; an inherited binding is dropped when a nearer type already declares the same link. */
function effective(it, field, keyFn){
  const out = [], seen = new Set();
  chain(it).forEach((t, depth) => {
    if (depth > 0 && !state.inherited) return;
    for (const b of (t[field] || [])) {
      const k = keyFn(b); if (seen.has(k)) continue; seen.add(k);
      out.push({ b, from: t, inherited: depth > 0 });
    }
  });
  return out;
}
const attrKey = b => b.ref;
const linkKey = b => [b.assoc, b.role, b.ref].join("|");
function descendants(it){
  const out = [], stack = [...it.subtypes], seen = new Set([it]);
  while (stack.length) { const x = stack.shift(); if (seen.has(x)) continue; seen.add(x); out.push(x); stack.push(...x.subtypes); }
  return out;
}


/* ---------- what branches out of a circle ---------- */
/* Line categories: the colour of a line says how the two circles are linked. */
const CAT = {
  super:{title:"Inherits from",legend:"Inherits from (supertype)"},
  sub:{title:"Subtypes",legend:"Subtype (is a kind of)"},
  in:{title:"Linked from",legend:"Links in (points here)"},
  feat:{title:"Feature links",legend:"Feature link"},
  info:{title:"Information links",legend:"Information link"},
  attr:{title:"Attributes",legend:"Has attribute"},
  parts:{title:"Parts",legend:"Has part (complex attribute)"},
  used:{title:"Used by",legend:"Used by"},
  val:{title:"Values",legend:"Allowed value"},
  roles:{title:"Roles",legend:"Association or role"},
  assoc:{title:"Associations",legend:""},
  path:{title:"Traced path",legend:"Traced path"}
};
const shortText = b => [b.role && "role " + b.role, b.mult?.text].filter(Boolean).join(" · ");
const linkText = b => [b.assocItem?.name || b.assoc, b.role && "role " + b.role, b.mult?.text].filter(Boolean).join(" · ");

/* The catalogue never changes once read, so each type's branches are worked out once and kept. */
const branchMemo = new WeakMap();
function branches(it){
  let G = branchMemo.get(it);
  if (!G || G.inherited !== state.inherited) { G = branchesOf(it); G.inherited = state.inherited; branchMemo.set(it, G); }
  return G;
}
function branchesOf(it){
  const G = [];
  const ent = (item, extra) => ({ item: item || null, ...extra });
  const k = it.kind;
  if (k === "ft" || k === "it") {
    if (it.sup) G.push({ cat:"super", entries:[ent(it.supItem || { missing:true, code:it.sup }, { label:"supertype" })] });
    G.push({ cat:"sub", entries: it.subtypes.map(s => ent(s, { label:"is a kind of " + (it.name || it.code) })) });
    const inc = it.incoming.map(({ from, b }) => ent(from, { label: linkText(b), short: shortText(b) }));
    for (const a of chain(it).slice(1)) for (const { from, b } of a.incoming) if (from !== it) inc.push(ent(from, { short: shortText(b), label: linkText(b) + " (to supertype " + (a.name || a.code) + ")", inherited:true }));
    for (const { from, b } of it.incoming) for (const d of descendants(from)) {
      const own = [...(d.fbind || []), ...(d.ibind || [])].some(x => linkKey(x) === linkKey(b));
      if (d !== it && !own) inc.push(ent(d, { short: shortText(b), label: linkText(b) + " (inherited from " + (from.name || from.code) + ")", inherited:true }));
    }
    G.push({ cat:"in", entries: dedupe(inc) });
    if (k === "ft") G.push({ cat:"feat", entries: effective(it, "fbind", linkKey).map(x => ent(x.b.item || { missing:true, code:x.b.ref }, { label: linkText(x.b), short: shortText(x.b), inherited:x.inherited, mult:x.b.mult })) });
    G.push({ cat:"info", entries: effective(it, "ibind", linkKey).map(x => ent(x.b.item || { missing:true, code:x.b.ref }, { label: linkText(x.b), short: shortText(x.b), inherited:x.inherited, mult:x.b.mult })) });
    G.push({ cat:"attr", entries: effective(it, "attrs", attrKey).map(x => ent(x.b.item || { missing:true, code:x.b.ref }, { label: (x.b.mult?.text || "") + (x.b.permitted.length && x.b.item?.values?.length ? " · " + x.b.permitted.length + " of " + x.b.item.values.length + " values" : ""), inherited:x.inherited, mult:x.b.mult, permitted:x.b.permitted })) });
  } else if (k === "sa") {
    G.push({ cat:"used", entries: it.usedBy.map(({ from, b }) => ent(from, { label: b.mult?.text || "" })) });
    G.push({ cat:"val", entries: it.values.map(v => ({ val: v, attr: it })) });
  } else if (k === "ca") {
    G.push({ cat:"used", entries: it.usedBy.map(({ from, b }) => ent(from, { label: b.mult?.text || "" })) });
    G.push({ cat:"parts", entries: it.subs.map(b => ent(b.item || { missing:true, code:b.ref }, { label: b.mult?.text || "" })) });
  } else if (k === "fa" || k === "ia") {
    G.push({ cat:"used", entries: it.usedBy.map(({ from, b }) => ent(from, { label: "→ " + (b.item?.name || b.ref) + (b.role ? " as " + b.role : "") })) });
    const roles = it.roleItems.map(r => ent(r, { label:"role" }));
    for (const a of chain(it).slice(1)) for (const r of a.roleItems || []) if (!it.roleItems.some(x => x.code === r.code)) roles.push(ent(r, { label:"role (inherited)", inherited:true }));
    G.push({ cat:"roles", entries: roles });
    if (it.sup) G.push({ cat:"super", entries:[ent(it.supItem || { missing:true, code:it.sup }, { label:"supertype" })] });
    G.push({ cat:"attr", entries: effective(it, "attrs", attrKey).map(x => ent(x.b.item || { missing:true, code:x.b.ref }, { label: x.b.mult?.text || "" })) });
  } else if (k === "ro") {
    G.push({ cat:"roles", entries: it.inAssoc.map(a => ent(a, { label:"declares this role" })) });
    G.push({ cat:"used", entries: it.usedBy.map(({ from, b }) => ent(from, { label: "→ " + (b.item?.name || b.ref) + (b.assoc ? " via " + b.assoc : "") })) });
  }
  return G.filter(g => g.entries.length);
}
function dedupe(list){ const seen = new Set(); return list.filter(e => { const k = e.item ? keyOf(e.item) : ""; if (seen.has(k)) return false; seen.add(k); return true; }); }

function neighbours(it, wide){
  const out = [], add = (to, label, dir, short) => { if (to && !to.missing) out.push({ to, label, dir, short }); };
  if (it.supItem) add(it.supItem, "inherits from", 1);
  for (const s of it.subtypes || []) add(s, "subtype", -1);
  for (const b of [...(it.fbind || []), ...(it.ibind || [])]) add(b.item, linkText(b), 1, shortText(b) || "link");
  for (const { from, b } of it.incoming || []) add(from, linkText(b), -1, shortText(b) || "link");
  if (it.kind === "fa" || it.kind === "ia") { for (const { from } of it.usedBy) add(from, "uses association", -1); for (const r of it.roleItems || []) add(r, "role", 1); }
  if (it.kind === "ro") { for (const a of it.inAssoc) add(a, "role", -1); for (const { from } of it.usedBy) add(from, "uses role", -1); }
  if (wide) {
    for (const b of [...(it.attrs || []), ...(it.subs || [])]) add(b.item, "attribute", 1);
    if (it.kind === "sa" || it.kind === "ca") for (const { from } of it.usedBy) add(from, "attribute", -1);
    for (const b of [...(it.fbind || []), ...(it.ibind || [])]) { add(b.assocItem, "association", 1); add(b.roleItem, "role", 1); }
  }
  return out;
}
function bfs(a, b, wide){
  const prev = new Map([[a, null]]), q = [a];
  while (q.length) { const x = q.shift(); if (x === b) break; for (const n of neighbours(x, wide)) if (!prev.has(n.to)) { prev.set(n.to, { from:x, edge:n }); q.push(n.to); } }
  if (!prev.has(b)) return null;
  const steps = []; let c = b;
  while (prev.get(c)) { const p = prev.get(c); steps.unshift({ from:p.from, to:c, edge:p.edge }); c = p.from; }
  return steps;
}

window.XO = window.XO || {};
XO.fc = { KIND, ORDER, CAT, keyOf, parseFC, decode, branches, neighbours, bfs, chain, linkText, shortText,
  isCatalogue: doc => doc.documentElement && doc.documentElement.localName === "S100_FC_FeatureCatalogue" };
})();
