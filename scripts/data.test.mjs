import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Script } from "node:vm";
import test from "node:test";
import { packStudy, validatePacked, DIMENSIONS } from "../src/data.mjs";
import { brickGeometry, MM_TO_WORLD } from "../src/geometry.mjs";
import { locales } from "../src/locales.mjs";

const root = new URL("../", import.meta.url);
const index = JSON.parse(await readFile(new URL("data/index.json", root)));
const expected = {
  "simple-400": 2476, "simple-608": 5703, "simple-800": 10124, "simple-992": 15733,
  "mechanical-400": 2498, "mechanical-608": 5753, "mechanical-800": 10146, "mechanical-992": 15869,
};
const hash = data => createHash("sha256").update(data).digest("hex");

function paths(object, prefix = "") {
  return Object.entries(object).flatMap(([key, value]) => typeof value === "object"
    ? paths(value, `${prefix}${key}.`) : [`${prefix}${key}`]).sort();
}

test("both language catalogs have exactly the same complete key set", () => {
  assert.deepEqual(paths(locales.ja), paths(locales.en));
  for (const locale of Object.values(locales)) {
    const leaves = object => Object.values(object).flatMap(value =>
      typeof value === "object" ? leaves(value) : [value]);
    assert.ok(leaves(locale).every(value => typeof value === "string" && value.length > 0));
  }
});

for (const entry of index) {
  test(`lossless placement packing: ${entry.style}-${entry.diameter_mm}`, async () => {
    const bytes = await readFile(new URL(`data/${entry.style}/${entry.diameter_mm}/study.json`, root));
    const study = JSON.parse(bytes);
    const model = packStudy(study, entry, hash(bytes));
    assert.equal(model.parts.length, expected[model.key]);
    assert.deepEqual(model.dimensions, DIMENSIONS);
    assert.deepEqual(model.palette, Object.entries(study.palette));
    for (const [i, part] of study.sizes[0].parts.entries()) {
      const [x, y, nx, ny, z, color] = model.parts[i];
      assert.deepEqual([x, y, nx, ny, z],
        [part.x, part.y, part.nx, part.ny, part.base_z_mm ?? part.layer * 9.6]);
      assert.equal(model.palette[color][0], part.color);
    }
    assert.deepEqual(validatePacked(model).colors, entry.summary.colors);
  });
}

for (const language of ["ja", "en"]) {
  test(`${language}: standalone payload, translated templates and exact embedded datasets`, async () => {
    const directory = language === "ja" ? "docs/" : "docs/en/";
    const html = await readFile(new URL(`${directory}viewer360.html`, root), "utf8");
    const comparison = await readFile(new URL(`${directory}index.html`, root), "utf8");
    const manifest = JSON.parse(await readFile(new URL(`${directory}viewer360-manifest.json`, root)));
    assert.equal(hash(html), manifest.outputSha256);
    assert.equal(manifest.language, language);
    assert.equal(manifest.models.length, 8);
    assert.match(manifest.buildId, /^[a-f0-9]{12}$/);
    assert.ok(html.includes(`<html lang="${language}"`));
    assert.ok(html.includes(locales[language].ui.warning));
    assert.ok(comparison.includes(locales[language].ui.warning));
    assert.doesNotMatch(html, /__BOOT_TEXT__|__HARO_BUILD_ID__|\[\[\w+\]\]|<script[^>]+src=|type="module"/);
    assert.doesNotMatch(html, /plugin:notification|is_permission_granted/);
    assert.match(html, /connect-src 'none'/);
    assert.match(html, /MIT License/);
    for (const page of [html, comparison]) {
      for (const [, script] of page.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(script);
    }
    assert.equal((comparison.match(/class="model"/g) || []).length, 8);
    assert.equal((comparison.match(/<img /g) || []).length, 10);
    assert.doesNotMatch(comparison, /data:image\//);
    for (const entry of index) {
      const key = `${entry.style}-${entry.diameter_mm}`;
      const match = html.match(new RegExp(`<script id="data-${key}" type="application/json">([^<]+)</script>`));
      assert.ok(match, key);
      const embedded = JSON.parse(match[1]);
      const bytes = await readFile(new URL(`data/${entry.style}/${entry.diameter_mm}/study.json`, root));
      assert.deepEqual(embedded, packStudy(JSON.parse(bytes), entry, hash(bytes)));
    }
  });
}

test("fixed mm conversion and the three unchanged brick envelopes", () => {
  assert.equal(MM_TO_WORLD, 0.001);
  for (const [nx, ny] of [[2, 2], [2, 4], [4, 2]]) {
    const geometry = brickGeometry(nx, ny);
    const min = geometry.boundingBox.min.toArray();
    const max = geometry.boundingBox.max.toArray();
    [0.1, 0.1, 0].forEach((value, i) => assert.ok(Math.abs(min[i] - value) < 0.000002));
    [nx * 8 - 0.1, ny * 8 - 0.1, 11.4].forEach((value, i) => assert.ok(Math.abs(max[i] - value) < 0.000002));
    assert.equal(geometry.index.count / 3, 12 + nx * ny * 36);
    geometry.dispose();
  }
});

test("invalid physical dimensions and counts are rejected", async () => {
  const bytes = await readFile(new URL("data/simple/400/study.json", root));
  const original = packStudy(JSON.parse(bytes), index[0], hash(bytes));
  for (const mutate of [
    model => { model.dimensions.pitchMm = 16; },
    model => { model.parts.pop(); },
    model => { model.parts[0][2] = 1; },
    model => { model.boundsMm.max[0]++; },
    model => { model.status = "PRINT_READY"; },
  ]) {
    const model = structuredClone(original);
    mutate(model);
    assert.throws(() => validatePacked(model));
  }
});
