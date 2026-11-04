#!/usr/bin/env node
/* Smoke test (RULES.md rule 14): no change is done until this passes with zero failures.
   It serves the project folder itself, opens the page in headless Chromium and checks the behaviours
   that past bugs broke. Run: node tools/smoke.mjs   (needs Playwright: npm i -g playwright, or npx playwright install chromium)
   Exit code 0 = all passed, 1 = something failed (each failure is printed with what was expected). */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

/* --- the project root is the folder above tools/ --- */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* --- find Playwright whether it is installed locally or globally --- */
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { try { ({ chromium } = await import("playwright")); } catch { console.error("Playwright is not installed. Install it with: npm i -g playwright && npx playwright install chromium"); process.exit(2); } }

/* --- a tiny static server so fetch() of the examples works exactly as when served for real --- */
const TYPES = { ".html":"text/html", ".js":"text/javascript", ".xml":"application/xml", ".css":"text/css", ".md":"text/markdown" };
const server = http.createServer((req, res) => {
  /* map the URL to a file under ROOT, refusing anything that climbs out of it */
  const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const URL0 = `http://127.0.0.1:${server.address().port}/index.html`;

/* --- tiny test harness: each check records pass/fail with the expectation that failed --- */
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok:!!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : "  — " + detail}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{ width:1440, height:900 } });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
page.on("dialog", d => { errors.push("dialog opened: " + d.message()); d.dismiss(); });

try {
  /* 1. default example loads */
  await page.goto(URL0);
  await page.waitForFunction(() => window.XO?.app?.O?.order?.length > 1, null, { timeout:15000 });
  const start = await page.evaluate(() => ({ mode:XO.app.src.mode, n:XO.app.O.order.length, version:XO.VERSION }));
  check("default example loads", start.n > 1, JSON.stringify(start));

  /* 2. the version shown matches the newest changelog entry (rule 19 gate) */
  const top = (fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8").match(/^## (\d+\.\d+\.\d+)/m) || [])[1];
  check("VERSION matches CHANGELOG", start.version && start.version === top, `app ${start.version}, changelog ${top}`);

  const r = await page.evaluate(async () => {
    const A = XO.app, out = {};
    const text = async u => await (await fetch(u)).text();
    /* 3. plain XML example: tree mode, references found */
    A.loadText(await text("samples/S-201_dataset_example.xml"), "samples/S-201_dataset_example.xml");
    out.treeMode = A.src.mode;
    const fs5 = A.src.search("FS.005").find(x => x.label.startsWith("child"));
    A.reveal(fs5.id);
    out.refLinks = A.O.links.filter(l => l.kind === "cross").length;
    out.refLabel = A.O.bodies.get(fs5.id)?.label;
    /* 4. open and fold keep every body unique */
    const ids = () => A.O.order.map(b => b.id);
    const firstOpenable = A.O.order.find(b => b.parent && A.src.canOpen(b.id) && !A.O.open.has(b.id));
    A.clickBody(firstOpenable); const afterOpen = ids();
    A.clickBody(A.O.bodies.get(firstOpenable.id)); const afterFold = ids();
    out.unique = new Set(afterOpen).size === afterOpen.length && new Set(afterFold).size === afterFold.length;
    out.openGrew = afterOpen.length > afterFold.length;
    /* 5. catalogue view: no body appears twice when one item sits in two groups */
    A.loadText(await text("samples/S-201_FC_OpenS100_draft.xml"), "samples/S-201_FC_OpenS100_draft.xml");
    A.clickBody(A.O.order.find(b => b.label === "Equipment"));
    const cids = A.O.order.map(b => b.id); out.catalogueUnique = new Set(cids).size === cids.length;
    /* 6. drag: a body pulled off its orbit returns and keeps its parent */
    A.playing = false;
    const b = A.O.order.find(x => x.depth === 1 && x.type !== "group"), parent = b.parent.id;
    b.dragging = true; b.x += 150; b.y += 90; A.O.step(0.016, false);
    b.dragging = false; for (let i = 0; i < 180; i++) A.O.step(1 / 60, false);
    out.dragBack = Math.hypot(b.x - b.ax, b.y - b.ay); out.dragParent = b.parent.id === parent;
    /* 7. a deep file stays a bounded size */
    let x = "<a0>"; for (let i = 1; i <= 16; i++) x += `<a${i} id="n${i}"><s1/><s2/><s3/>`; for (let i = 16; i >= 1; i--) x += `</a${i}>`; x += "</a0>";
    A.loadText(x, "deep.xml"); A.reveal(A.src.search("n16")[0].id);
    out.deepExtent = A.O.extent(); out.deepSel = A.O.bodies.get(A.sel)?.label;
    /* 8. namespaces kept apart, own id wins the label, broken references listed */
    A.loadText('<r xmlns:a="urn:a" xmlns:b="urn:b" xmlns:xlink="http://www.w3.org/1999/xlink"><a:item/><b:item/><f xml:id="F2" xlink:href="#F1"/><h ref="nope"/></r>', "ns.xml");
    out.labels = A.O.order.map(o => o.label);
    out.broken = A.src.info(A.src.search("nope")[0].id).broken;
    /* 9. an element named parsererror is fine; malformed XML gets a message that says so */
    A.loadText("<root><parsererror>fine</parsererror></root>", "pe.xml"); out.perr = A.O.order.length;
    try { A.loadText("<a><b></a>", "bad.xml"); out.bad = "loaded"; } catch (e) { out.bad = e.message; }
    /* 10. file text is never run as HTML anywhere it is shown */
    A.loadText('<x name="&lt;img src=x onerror=window.__pwned=1&gt;"><y title="&quot;&gt;&lt;b&gt;">&lt;script&gt;window.__pwned=1&lt;/script&gt;</y></x>', "xss.xml");
    for (const o of A.O.order) { A.clickBody(o); }
    document.getElementById("q").value = "img"; document.getElementById("q").dispatchEvent(new Event("input"));
    out.injected = !!document.querySelector("#side img, #side script, #side b, #results img, #tip img, #legendBody img") || !!window.__pwned;
    /* 11. determinism: the same file twice gives the same orbits */
    const sig = () => A.O.order.map(o => `${o.id}:${o.ring ? o.ring.r.toFixed(3) + "@" + o.a0.toFixed(4) : "root"}`).join("|");
    const ds = await text("samples/S-201_dataset_example.xml");
    A.loadText(ds, "a.xml"); const s1 = sig(); A.loadText(ds, "b.xml"); const s2 = sig();
    out.deterministic = s1 === s2;
    return out;
  });
  check("plain XML opens in tree view", r.treeMode === "tree", r.treeMode);
  check("id references become dashed links", r.refLinks > 0, `cross links: ${r.refLinks}`);
  check("reference element is named by its target", /→ FS\.005/.test(r.refLabel || ""), r.refLabel);
  check("open and fold keep bodies unique", r.unique && r.openGrew, JSON.stringify({ unique:r.unique, grew:r.openGrew }));
  check("catalogue view has no duplicate bodies", r.catalogueUnique);
  check("dragged body springs back to its orbit", r.dragBack < 1 && r.dragParent, `distance ${r.dragBack?.toFixed(2)}, same parent ${r.dragParent}`);
  check("deep file stays bounded", r.deepExtent < 5000 && r.deepSel === "a16 · n16", `extent ${Math.round(r.deepExtent)}, selected ${r.deepSel}`);
  check("namespaced tags stay apart", r.labels.includes("a:item") && r.labels.includes("b:item"), r.labels.join(", "));
  check("element named by its own id", r.labels.includes("f · F2"), r.labels.join(", "));
  check("broken reference is listed", (r.broken || []).some(t => t.includes("nope")), JSON.stringify(r.broken));
  check("element called parsererror is accepted", r.perr === 2, String(r.perr));
  check("malformed XML gets a clear message", /not well-formed/i.test(r.bad), r.bad);
  check("file text is never run as HTML", !r.injected);
  check("same file gives the same orbits", r.deterministic);

  /* 12. phone width: no sideways scroll */
  await page.setViewportSize({ width:400, height:820 });
  await page.waitForTimeout(300);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check("no horizontal scroll at phone width", sw <= 400, `scrollWidth ${sw}`);
} catch (e) {
  check("smoke run finished", false, e.stack || e.message);
}
check("no errors in the browser console", errors.length === 0, errors.join(" | "));

await browser.close(); server.close();
const failed = results.filter(x => !x.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
