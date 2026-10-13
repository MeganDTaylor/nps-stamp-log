// Bundles public/ into one HTML file for the claude.ai preview artifact.
// Usage: node tools/build-preview.mjs [out.html]
// The real site doesn't need this; Firebase Hosting serves public/ as is.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const out = process.argv[2] || join(root, "dist", "stamp-trail-preview.html");

const html = read("public/index.html");
const title = html.match(/<title>.*?<\/title>/)[0];
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/)[0];
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"))
  .replace(/<script type="module"[^>]*><\/script>\s*/, "");

// The preview frame already pads for the phone's safe areas.
const css = read("public/css/app.css").replace(/html\{padding-top:[^}]*\}\n?/, "");

// Join the modules into one script: drop local imports and the export keywords.
const modules = ["units.js", "us-states.js", "nps.js", "firebase-config.js", "store.js", "app.js"].map((f) =>
  `// ---- ${f} ----\n` + read("public/js/" + f)
    .replace(/^import \{[^}]*\} from "\.\/[^"]+";\n/gm, "")
    .replace(/^export (const|class|async function|function) /gm, "$1 "));
if (/^\s*(import|export) /m.test(modules.join("\n"))) throw new Error("A module still has an import or export line.");

const page = `${title}
${fonts}
<style>
${read("tools/vendor/leaflet.css")}
</style>
<style>
${css}
</style>
${body.trim()}
<script type="module">
${modules.join("\n")}
</script>
`;
import("node:fs").then(({ mkdirSync }) => { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, page); console.log(`Wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`); });
