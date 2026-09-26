import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { DIAMETERS, DIMENSIONS, STYLES, TUPLE_FIELDS, packStudy, requireValue } from "../src/data.mjs";
import { locales } from "../src/locales.mjs";
import { comparisonPage, escapeHtml, phrase } from "../src/comparison.mjs";

const root = new URL("../", import.meta.url);
const hash = value => createHash("sha256").update(value).digest("hex");
const safeJSON = value => JSON.stringify(value).replaceAll("<", "\\u003c");
const config = JSON.parse(await readFile(new URL("site.json", root)));
requireValue(config.repository === "https://github.com/ktanino10/haro-brick-kit", "Unexpected publication target");
const indexBytes = await readFile(new URL("data/index.json", root));
const index = JSON.parse(indexBytes);
const keys = Object.keys(STYLES).flatMap(style => DIAMETERS.map(size => `${style}-${size}`));
requireValue(index.length === 8 && new Set(index.map(row => `${row.style}-${row.diameter_mm}`)).size === 8
  && index.every(row => keys.includes(`${row.style}-${row.diameter_mm}`)), "Expected exactly eight concepts");
const models = [];
for (const entry of index) {
  const data = await readFile(new URL(`data/${entry.style}/${entry.diameter_mm}/study.json`, root));
  models.push(packStudy(JSON.parse(data), entry, hash(data)));
}
const metadata = models.map(({ parts, palette, ...meta }) => meta);
const embedded = `<script id="model-index" type="application/json">${safeJSON(metadata)}</script>\n`
  + models.map(model => `<script id="data-${model.key}" type="application/json">${safeJSON(model)}</script>`).join("\n");
const license = await readFile(new URL("node_modules/three/LICENSE", root), "utf8");
const template = await readFile(new URL("src/viewer.template.html", root), "utf8");
const generated = [];
for (const locale of Object.values(locales)) {
  const prefix = locale.language === "ja" ? "docs/" : "docs/en/";
  await mkdir(new URL(prefix, root), { recursive: true });
  const values = {
    ...locale.ui, language: locale.language, otherLanguage: locale.otherLanguage, otherName: locale.otherName,
    languagePath: locale.language === "ja" ? "en/viewer360.html" : "../viewer360.html",
    styleSimple: locale.options.simple, styleMechanical: locale.options.mechanical,
    sourceUrl: config.repository, rightsUrl: `${config.repository}/blob/main/RIGHTS.md`,
  };
  let localized = template.replace(/\[\[(\w+)\]\]/g, (_, key) => {
    requireValue(typeof values[key] === "string", `Missing ${locale.language} template text: ${key}`);
    return escapeHtml(values[key]);
  });
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL("src/viewer.mjs", root))],
    bundle: true, write: false, format: "iife", platform: "browser", target: ["es2020"],
    minify: true, legalComments: "inline", logLevel: "warning",
    define: { __RUNTIME_TEXT__: JSON.stringify(locale.runtime) },
  });
  const script = bundle.outputFiles[0].text;
  requireValue(!/<\/script/i.test(script), "Unexpected script closing tag");
  localized = localized.replace("__BOOT_TEXT__", () => safeJSON(locale.boot))
    .replace("<!-- MODEL_DATA -->", () => embedded)
    .replace("/* VIEWER_BUNDLE */", () => script)
    .replace("<!-- THREE_LICENSE -->", () => escapeHtml(license));
  const buildId = hash(localized).slice(0, 12);
  const html = localized.replaceAll("__HARO_BUILD_ID__", buildId);
  requireValue(!/\[\[\w+\]\]|__BOOT_TEXT__|__HARO_BUILD_ID__|VIEWER_BUNDLE/.test(html), "Unexpanded template marker");
  await writeFile(new URL(`${prefix}viewer360.html`, root), html);
  const comparison = comparisonPage(locale, models, config.repository);
  await writeFile(new URL(`${prefix}index.html`, root), comparison);
  const manifest = {
    schemaVersion: 1, language: locale.language, buildId, outputSha256: hash(html),
    indexSha256: hash(indexBytes), library: { name: "Three.js", version: "0.180.0", license: "MIT, included in HTML" },
    dimensions: DIMENSIONS, placementTuple: TUPLE_FIELDS, units: "mm; one fixed 0.001 root conversion",
    models: metadata,
  };
  await writeFile(new URL(`${prefix}viewer360-manifest.json`, root), `${JSON.stringify(manifest, null, 2)}\n`);
  generated.push({ language: locale.language, buildId, bytes: Buffer.byteLength(html), models: models.length });

  const readmeTemplate = await readFile(new URL(`src/README.${locale.language}.template.md`, root), "utf8");
  const headings = [locale.comparison.style, locale.comparison.size, locale.comparison.bounds, locale.comparison.total];
  const table = `| ${headings.join(" | ")} |\n| --- | --- | --- | ---: |\n`
    + models.map(model => `| ${locale.styles[model.style]} | ${phrase(locale.comparison.class, { size: model.summary.size_class_cm })} | ${model.summary.body_bbox_mm.map(v => v.toFixed(1)).join(" × ")} mm | ${model.summary.brick_count.toLocaleString(locale.numberLocale)} |`).join("\n");
  const base = config.pagesUrl;
  const links = base ? (locale.language === "ja"
    ? `[日本語の比較ページ](${base}) · [360°ビュー](${base}viewer360.html) · [English site](${base}en/)`
    : `[English comparison](${base}en/) · [360° viewer](${base}en/viewer360.html) · [日本語サイト](${base})`)
    : (locale.language === "ja"
      ? "GitHub Pages の公開URLは、配信確認後にここへ記載します。ローカルでは `docs/index.html` を開けます。"
      : "The GitHub Pages URL will be listed here after deployment is verified. Open `docs/en/index.html` for the local site.");
  const readme = readmeTemplate.replace("[[SITE_LINKS]]", links).replace("[[TABLE]]", table);
  await writeFile(new URL(locale.language === "ja" ? "README.md" : "README.en.md", root), readme);
}
await writeFile(new URL("docs/.nojekyll", root), "");
await writeFile(new URL("THIRD_PARTY_NOTICES.txt", root),
  `Three.js 0.180.0, including OrbitControls and BufferGeometryUtils\nhttps://github.com/mrdoob/three.js\n\nThis notice covers the library only, not the Haro character, artwork or model data. See RIGHTS.md.\n\n${license}`);
console.log(JSON.stringify(generated, null, 2));
