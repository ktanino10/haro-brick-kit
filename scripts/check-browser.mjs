import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { chromium } from "playwright-core";
import { PNG } from "pngjs";
import { locales } from "../src/locales.mjs";
import { phrase } from "../src/comparison.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(process.env.HARO_TEST_OUTPUT || resolve(root, "test-output"));
await mkdir(output, { recursive: true });
const live = process.env.HARO_LIVE_URL ? new URL(process.env.HARO_LIVE_URL) : null;
if (live) assert.ok(live.protocol === "https:" && live.pathname.endsWith("/"));
const index = JSON.parse(await readFile(resolve(root, "data/index.json")));
const studies = new Map();
for (const row of index) {
  studies.set(`${row.style}-${row.diameter_mm}`,
    JSON.parse(await readFile(resolve(root, "data", row.style, String(row.diameter_mm), "study.json"))));
}
const report = {
  scope: live ? "Anonymous live site, repository subpath" : "Offline standalone and comparison files",
  liveUrl: live?.href || null, devices: [], ownership: [], errors: [], networkViolations: [], passed: false,
};
const browser = await chromium.launch({
  executablePath: process.env.HARO_BROWSER_PATH, headless: true, args: ["--disable-background-networking"],
});
const temporary = [];
const urlFor = (language, name) => live
  ? new URL(`${language === "en" ? "en/" : ""}${name}`, live).href
  : pathToFileURL(resolve(root, "docs", language === "en" ? "en" : "", name)).href;
const state = page => page.evaluate(() => globalThis.haroViewer.getState());
const near = (a, b, tolerance = 0.0001) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

async function context(options = {}, expectedErrors = false) {
  const ctx = await browser.newContext({ offline: !live, ...options });
  await ctx.route("**/*", route => {
    const url = new URL(route.request().url());
    if (["file:", "data:", "about:"].includes(url.protocol)
      || (live && url.origin === live.origin && url.pathname.startsWith(live.pathname))) return route.continue();
    report.networkViolations.push(url.href);
    return route.abort();
  });
  ctx.on("page", page => {
    page.on("console", message => {
      if (message.type() === "error" && !expectedErrors) report.errors.push(message.text());
    });
    page.on("pageerror", error => { if (!expectedErrors) report.errors.push(String(error)); });
  });
  return ctx;
}

async function ready(page, key) {
  await page.waitForFunction(key => {
    if (document.documentElement.dataset.viewerState === "error") {
      throw Error(document.getElementById("error-detail").textContent);
    }
    return document.documentElement.dataset.viewerState === "ready" && globalThis.haroViewer?.getState().key === key;
  }, key, { timeout: 60000 });
}

async function choose(page, row) {
  if (await page.locator("#style").inputValue() !== row.style) {
    const size = await page.locator("#size").inputValue();
    await page.selectOption("#style", row.style);
    await ready(page, `${row.style}-${size}`);
  }
  if (await page.locator("#size").inputValue() !== String(row.diameter_mm)) {
    await page.selectOption("#size", String(row.diameter_mm));
  }
  await ready(page, `${row.style}-${row.diameter_mm}`);
}

async function localized(page, language) {
  assert.equal(await page.locator("html").getAttribute("lang"), language);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const text = await page.locator("body").innerText();
  assert.ok(text.includes(locales[language].ui.warning));
  if (language === "en") assert.doesNotMatch(text.replaceAll("日本語", ""), /[ぁ-んァ-ン一-龯]/);
}

function pixels(buffer, fitted = true) {
  const image = PNG.sync.read(buffer);
  let count = 0;
  const bounds = [image.width, image.height, -1, -1];
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const i = (y * image.width + x) * 4;
    const [r, g, b] = image.data.subarray(i, i + 3);
    if (!(g > r * 1.1 && g > b * 1.25 && g - b > 30)) continue;
    count++;
    bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
    bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y);
  }
  assert.ok(count / (image.width * image.height) > 0.08, "Nonblank green brick geometry is required");
  if (fitted) assert.ok(bounds[0] > 2 && bounds[1] > 2 && bounds[2] < image.width - 3 && bounds[3] < image.height - 3);
  return { fraction: count / (image.width * image.height), bounds,
    sha256: createHash("sha256").update(buffer).digest("hex") };
}

function inspect(snapshot, study) {
  const { summary, parts } = study.sizes[0];
  assert.equal(snapshot.brickCount, summary.brick_count);
  assert.equal(snapshot.modelCount, 1); assert.equal(snapshot.meshCount, 3);
  assert.deepEqual(snapshot.rootScale, [0.001, 0.001, 0.001]);
  assert.deepEqual(snapshot.camera.up, [0, 0, 1]);
  assert.equal(snapshot.renderer.calls, 3); assert.equal(snapshot.renderer.geometries, 3);
  assert.equal(snapshot.renderer.contextLost, false);
  let studs = 0, triangles = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of snapshot.meshes) {
    const [nx, ny] = mesh.footprint;
    const expected = parts.filter(part => part.nx === nx && part.ny === ny);
    assert.equal(mesh.count, expected.length);
    const gmin = [Infinity, Infinity, Infinity], gmax = [-Infinity, -Infinity, -Infinity];
    mesh.positions.forEach((value, i) => {
      assert.ok(Number.isFinite(value)); const axis = i % 3;
      gmin[axis] = Math.min(gmin[axis], value); gmax[axis] = Math.max(gmax[axis], value);
    });
    [0.1, 0.1, 0].forEach((value, i) => near(gmin[i], value));
    [nx * 8 - 0.1, ny * 8 - 0.1, 11.4].forEach((value, i) => near(gmax[i], value));
    assert.equal(mesh.indices.length / 3, 12 + nx * ny * 36);
    for (let i = 0; i < expected.length; i++) {
      const part = expected[i];
      const position = [part.x * 8 - summary.target_diameter_mm / 2,
        part.y * 8 - summary.target_diameter_mm / 2, part.base_z_mm ?? part.layer * 9.6];
      const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...position, 1];
      matrix.forEach((value, j) => near(mesh.matrices[i * 16 + j], value));
      position.forEach((value, axis) => {
        near(mesh.colors[i * 3 + axis], study.palette[part.color][axis], 0.0000001);
        min[axis] = Math.min(min[axis], value + gmin[axis]);
        max[axis] = Math.max(max[axis], value + gmax[axis]);
      });
    }
    studs += nx * ny * mesh.count; triangles += mesh.count * mesh.indices.length / 3;
  }
  min.forEach((value, i) => near(value, snapshot.boundsMm.min[i]));
  max.forEach((value, i) => near(value, snapshot.boundsMm.max[i]));
  summary.body_bbox_mm.forEach((value, i) => near(max[i] - min[i], value));
  assert.equal(studs, summary.stud_cell_count); assert.equal(triangles, snapshot.renderer.triangles);
  return { count: parts.length, studs, triangles, boundsMm: { min, max }, allMatricesAndColorsMatch: true };
}

async function image(page) {
  await page.locator("#model-canvas").scrollIntoViewIfNeeded();
  return page.locator("#model-canvas").screenshot();
}

async function reset(page) {
  await page.click('[data-view="front"]');
  const s = await state(page);
  assert.ok(s.camera.position[1] < s.camera.target[1]);
  near(s.camera.position[2], s.camera.target[2], 1e-8);
  near(s.camera.distance, s.camera.fitDistance, 1e-8);
  assert.equal(s.autoRotateRequested, false);
}

async function interactions(page, ctx, mobile, language) {
  await reset(page);
  const front = await state(page);
  const frontImage = await image(page);
  const frontPixels = pixels(frontImage);
  if (!mobile) {
    const box = await page.locator("#model-canvas").boundingBox();
    const x = box.x + box.width / 2 + box.height / 4, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x - box.height / 2, y, { steps: 12 }); await page.mouse.up();
    assert.ok((await state(page)).camera.position[1] > front.camera.target[1]);
    const rear = await image(page); pixels(rear);
    assert.ok(!rear.equals(frontImage));
    await page.screenshot({ path: resolve(output, `${language}-desktop-rear.png`), fullPage: true });
    await reset(page);
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.wheel(0, -400);
    await page.waitForFunction(distance => globalThis.haroViewer.getState().camera.distance < distance * 0.9, front.camera.distance);
    assert.ok(pixels(await image(page), false).fraction > frontPixels.fraction * 1.1);
  } else {
    const cdp = await ctx.newCDPSession(page);
    const box = await page.locator("#model-canvas").boundingBox();
    const y = box.y + box.height / 2, x = box.x + box.width / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x + 80, y, id: 1 }] });
    for (let i = 1; i <= 12; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + 80 - i * 13, y, id: 1 }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    assert.ok(Math.abs((await state(page)).camera.position[0] - front.camera.position[0]) > 0.1);
    const points = spread => [{ x: x - spread, y, id: 1 }, { x: x + spread, y, id: 2 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(28) });
    for (let i = 1; i <= 10; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(28 + i * 5) });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    assert.ok((await state(page)).camera.distance < front.camera.distance * 0.8);
    near(await page.evaluate(() => visualViewport.scale), 1);
  }
  await reset(page);
  for (const [view, sign] of [["top", 1], ["bottom", -1]]) {
    await page.click(`[data-view="${view}"]`);
    const s = await state(page);
    assert.ok((s.camera.position[2] - s.camera.target[2]) * sign > s.camera.distance * 0.99);
    pixels(await image(page));
  }
  await reset(page);
  await page.click("#auto-rotate");
  assert.equal(await page.locator("#auto-rotate").innerText(), locales[language].runtime.autoStop);
  await page.waitForFunction(initial => {
    const current = globalThis.haroViewer.getState();
    return Math.abs(current.camera.position[0] - initial.camera.position[0]) > 0.01;
  }, await state(page));
  await page.click("#auto-rotate");
  const paused = await state(page);
  await page.waitForTimeout(250);
  assert.deepEqual((await state(page)).camera.position, paused.camera.position);
  await page.click("#auto-rotate");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hidden = await state(page);
  await page.waitForTimeout(250);
  assert.equal((await state(page)).renderedFrames, hidden.renderedFrames);
  await page.evaluate(() => {
    delete document.hidden; delete document.visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForFunction(frames => globalThis.haroViewer.getState().renderedFrames > frames, hidden.renderedFrames);
  await reset(page);
  return { orbit: true, zoom: true, touch: mobile, topAndUnderside: true, reset: true,
    autoStartStop: true, hiddenPauseResume: "visibility-event emulation" };
}

async function comparison(ctx, language) {
  const page = await ctx.newPage();
  await page.goto(urlFor(language, "index.html"));
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
  assert.equal(await page.locator("img.model").count(), 8);
  assert.equal(await page.locator("img").count(), 10);
  assert.equal(await page.locator("tbody tr").count(), 8);
  await page.click("#physical");
  await page.waitForFunction(ratios => [...document.querySelectorAll("img.model")].every((image, i) =>
    Math.abs(new DOMMatrix(getComputedStyle(image).transform).a - ratios[i]) < 0.00001),
  index.map(row => row.diameter_mm / 992));
  const scales = await page.locator("img.model").evaluateAll(images => images.map(image => new DOMMatrix(getComputedStyle(image).transform).a));
  index.forEach((row, i) => near(scales[i], row.diameter_mm / 992, 0.00001));
  await page.click("#normalized");
  await page.waitForFunction(() => [...document.querySelectorAll("img.model")].every(image =>
    Math.abs(new DOMMatrix(getComputedStyle(image).transform).a - 1) < 0.00001));
  for (const scale of await page.locator("img.model").evaluateAll(images => images.map(image => new DOMMatrix(getComputedStyle(image).transform).a))) near(scale, 1);
  await page.locator("details summary").click();
  await localized(page, language);
  await page.locator(".caption a").last().click(); await ready(page, "mechanical-992");
  await page.locator("nav a").first().click();
  await page.waitForURL(url => url.pathname.endsWith("/index.html"));
  await page.locator("#language-switch").click();
  assert.equal(await page.locator("html").getAttribute("lang"), locales[language].otherLanguage);
  await localized(page, locales[language].otherLanguage);
  await page.close();
  return { images: 10, tableRows: 8, scaleRoundTrip: true, viewerBackLinks: true, languageSwitch: true };
}

async function ownership(language) {
  const locale = locales[language];
  const message = "Command plugin:notification|is_permission_granted not allowed by ACL";
  const ctx = await context({ viewport: { width: 1000, height: 850 } }, true);
  await ctx.addInitScript(message => {
    globalThis.probeStages = [];
    const observer = new MutationObserver(() => {
      const stage = globalThis.haroBoot?.snapshot().stage;
      if (["bootstrap", "await-layout"].includes(stage) && !globalThis.probeStages.includes(stage)) {
        globalThis.probeStages.push(stage);
        void Promise.reject(message);
      }
      if (globalThis.probeStages.length === 2) observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true, characterData: true });
  }, message);
  const page = await ctx.newPage();
  await page.goto(urlFor(language, "viewer360.html"));
  await ready(page, "simple-400");
  await page.waitForFunction(() => globalThis.haroBoot.snapshot().pageErrorCount >= 2);
  const injectedAt = await page.evaluate(() => globalThis.probeStages);
  assert.deepEqual(injectedAt, ["bootstrap", "await-layout"]);
  assert.equal((await state(page)).brickCount, 2476);
  assert.equal(await page.evaluate(() => globalThis.haroBoot.snapshot().error), null);
  await page.evaluate(message => { void Promise.reject(message); }, message);
  await page.waitForFunction(() => globalThis.haroBoot.snapshot().pageErrorCount >= 3);
  await page.click('[data-view="back"]');
  pixels(await image(page));
  assert.equal((await state(page)).brickCount, 2476);
  assert.equal(await page.locator("#error").isVisible(), false);
  await page.locator("#boot-diagnostics summary").click();
  await localized(page, language);
  await page.evaluate(() => document.getElementById("data-simple-608").remove());
  await page.selectOption("#size", "608");
  await page.waitForFunction(() => document.documentElement.dataset.viewerState === "error");
  assert.equal(await page.locator("#error strong").innerText(), locale.ui.errorTitle);
  assert.equal(await page.evaluate(() => globalThis.haroBoot.snapshot().failureOperation), locale.runtime.opLoad);
  assert.equal(await page.locator("#brick-count").innerText(), "—");
  assert.equal((await state(page)).brickCount, 0);
  await localized(page, language);
  await ctx.close();
  if (!live) {
    const source = await readFile(resolve(root, "docs", language === "en" ? "en" : "", "viewer360.html"), "utf8");
    const start = source.lastIndexOf("<script>"), end = source.indexOf("</script>", start) + 9;
    const path = resolve(output, `missing-engine-${language}.html`);
    temporary.push(path);
    await writeFile(path, source.slice(0, start) + source.slice(end));
    const missing = await context({ viewport: { width: 900, height: 850 } }, true);
    const missingPage = await missing.newPage();
    await missingPage.goto(pathToFileURL(path).href);
    await missingPage.waitForFunction(() => document.documentElement.dataset.viewerState === "error");
    assert.equal(await missingPage.locator("#error strong").innerText(), locale.ui.errorTitle);
    assert.equal(await missingPage.evaluate(() => globalThis.haroBoot.snapshot().failureOperation), locale.boot.opCompletion);
    await localized(missingPage, language);
    await missing.close();
  }
  const lost = await context({ viewport: { width: 1000, height: 850 } }, true);
  const lostPage = await lost.newPage();
  await lostPage.goto(urlFor(language, "viewer360.html")); await ready(lostPage, "simple-400");
  await lostPage.evaluate(() => document.getElementById("model-canvas").getContext("webgl2").getExtension("WEBGL_lose_context").loseContext());
  await lostPage.waitForFunction(() => document.documentElement.dataset.viewerState === "error");
  assert.equal(await lostPage.evaluate(() => globalThis.haroBoot.snapshot().failureOperation), locale.runtime.opContext);
  await localized(lostPage, language);
  await lost.close();
  return { language, injectedAt, externalRejectionsBeforeFirstFrameAndAfterReady: true, modelPreserved: true,
    missingDataFatal: true, missingEngineFatal: !live, contextLossFatal: true, errorsLocalized: true };
}

try {
  for (const language of ["ja", "en"]) for (const mobile of [false, true]) {
    const viewport = mobile ? { width: 375, height: 850 } : { width: 1440, height: 1050 };
    const ctx = await context({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const page = await ctx.newPage(); await page.goto(urlFor(language, "viewer360.html"));
    await ready(page, "simple-400");
    const record = { language, mobile, viewport, models: [] };
    report.devices.push(record);
    for (const row of index) {
      await choose(page, row);
      const key = `${row.style}-${row.diameter_mm}`;
      const snapshot = await page.evaluate(() => globalThis.haroViewer.inspectModel());
      const actual = inspect(snapshot, studies.get(key));
      assert.equal(await page.locator("#model-name").innerText(),
        phrase(locales[language].runtime.modelName, { style: locales[language].styles[row.style], size: row.summary.size_class_cm }));
      assert.equal(await page.locator("#dimensions").innerText(), `${row.summary.body_bbox_mm.map(v => v.toFixed(1)).join(" × ")} mm`);
      record.models.push({ key, ...actual, pixels: pixels(await image(page)) });
      await localized(page, language);
      console.log(`${live ? "live" : "offline"} ${language} ${mobile ? "375px" : "desktop"} ${key}: ${actual.count} bricks`);
    }
    await page.screenshot({ path: resolve(output, `${language}-${mobile ? "mobile" : "desktop"}-front.png`), fullPage: true });
    record.controls = await interactions(page, ctx, mobile, language);
    for (const detail of await page.locator("details").all()) {
      if (await detail.getAttribute("open") === null) await detail.locator("summary").click();
    }
    await localized(page, language);
    await page.locator("#language-switch").click();
    await ready(page, "mechanical-992");
    assert.equal(await page.locator("html").getAttribute("lang"), locales[language].otherLanguage);
    await page.locator("#language-switch").click(); await ready(page, "mechanical-992");
    record.viewerLanguageRoundTripKeepsSelection = true;
    assert.equal(await page.locator("#download-viewer").getAttribute("href"), "viewer360.html");
    assert.notEqual(await page.locator("#download-viewer").getAttribute("download"), null);
    if (live) {
      const downloadPromise = page.waitForEvent("download");
      await page.locator("#download-viewer").click();
      const download = await downloadPromise;
      const saved = resolve(output, `${language}-${mobile ? "mobile" : "desktop"}-download.html`);
      await download.saveAs(saved); temporary.push(saved);
      const savedText = await readFile(saved, "utf8");
      assert.ok(savedText.includes('id="data-mechanical-992"') && savedText.includes("MIT License"));
    }
    record.downloadLinkPresent = true;
    record.httpDownloadVerified = Boolean(live);
    record.comparison = await comparison(ctx, language);
    await ctx.close();
  }
  if (!live) for (const language of ["ja", "en"]) {
    const path = resolve(output, `standalone-${language}.html`);
    temporary.push(path);
    await writeFile(path, await readFile(resolve(root, "docs", language === "en" ? "en" : "", "viewer360.html")));
    const ctx = await context({ viewport: { width: 1000, height: 850 } });
    const page = await ctx.newPage();
    await page.goto(`${pathToFileURL(path).href}?style=mechanical&size=992`);
    await ready(page, "mechanical-992");
    pixels(await image(page));
    assert.equal((await state(page)).brickCount, 15869);
    await ctx.close();
  }
  for (const language of ["ja", "en"]) report.ownership.push(await ownership(language));
  assert.deepEqual(report.networkViolations, []);
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = String(error.stack || error);
  throw error;
} finally {
  await browser.close();
  for (const path of temporary) await rm(path, { force: true });
  await writeFile(resolve(output, "browser-results.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Results: ${resolve(output, "browser-results.json")}`);
}
