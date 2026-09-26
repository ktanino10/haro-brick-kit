import {
  Box3, Color, DirectionalLight, Group, HemisphereLight, InstancedMesh,
  LinearSRGBColorSpace, Matrix4, MeshStandardMaterial, PerspectiveCamera,
  Scene, SRGBColorSpace, TOUCH, Vector3, WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { DIAMETERS, DIMENSIONS, FOOTPRINTS, STYLES, requireValue, validatePacked } from "./data.mjs";
import { MM_TO_WORLD, addSeamShading, brickGeometry } from "./geometry.mjs";

const text = __RUNTIME_TEXT__;
const phrase = globalThis.haroBoot.phrase;
globalThis.haroBoot.step("program", text.program);

const ui = Object.fromEntries([
  "viewport", "loading", "loading-message", "style", "size", "auto-rotate", "model-name",
  "brick-count", "dimensions", "brick-types", "rib-count", "model-status", "view-label",
].map(id => [id, document.getElementById(id)]));
const number = value => value.toLocaleString(text.numberLocale);
const modelName = data => phrase(text.modelName, {
  style: text.styles[data.style], size: data.summary.size_class_cm,
});
let renderer, camera, controls, scene, model;
let status = "loading";
let selected = null;
let generation = 0;
let autoRotate = false;
let frame = 0;
let lastFrame = 0;
let renderedFrames = 0;
let radius = 1;
let fitDistance = 1;
let worldBounds = null;
const center = new Vector3();
const geometries = new Map();

function stopFrames() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  lastFrame = 0;
}

function owned(operation, callback) {
  return (...args) => globalThis.haroBoot.run(operation, () => callback(...args));
}

window.addEventListener("haro-fatal", owned(text.opCleanup, () => {
  status = "error";
  generation++;
  autoRotate = false;
  stopFrames();
  selected = null;
  worldBounds = null;
  if (controls) {
    controls.enabled = false;
    controls.autoRotate = false;
  }
  disposeModel();
}));

function fail(error, operation) {
  globalThis.haroFail(error, operation);
}

function requestRender() {
  if (!frame && status === "ready" && !document.hidden) frame = requestAnimationFrame(render);
}

function render(time) {
  frame = 0;
  if (status !== "ready" || document.hidden) return;
  try {
    if (autoRotate) controls.update(lastFrame ? Math.min((time - lastFrame) / 1000, 0.1) : 0);
    renderer.render(scene, camera);
    requireValue(renderer.info.render.calls > 0 && renderer.info.render.triangles > 0,
      "No brick geometry was drawn");
    renderedFrames++;
    lastFrame = time;
    if (document.documentElement.dataset.viewerState !== "ready") {
      globalThis.haroBoot.step("ready", text.ready);
    }
    ui.loading.hidden = true;
    ui.viewport.setAttribute("aria-busy", "false");
    document.documentElement.dataset.viewerState = "ready";
    if (autoRotate) requestRender();
  } catch (error) {
    fail(error, text.opRender);
  }
}

function setAutoRotate(value) {
  autoRotate = value;
  if (controls) controls.autoRotate = value;
  ui["auto-rotate"].setAttribute("aria-pressed", String(value));
  ui["auto-rotate"].textContent = value ? text.autoStop : text.autoStart;
  lastFrame = 0;
  requestRender();
}

function disposeModel() {
  if (!model) return;
  const previous = model;
  model = null;
  scene.remove(previous);
  for (const mesh of previous.children) mesh.dispose();
  previous.clear();
}

function calculateFit() {
  const vertical = camera.fov * Math.PI / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
  fitDistance = radius / Math.sin(Math.min(vertical, horizontal) / 2) * 1.08;
  camera.near = Math.max(radius / 500, 0.0001);
  camera.far = Math.max(radius * 60, fitDistance * 7);
  controls.minDistance = radius * 1.1;
  controls.maxDistance = fitDistance * 5;
  camera.updateProjectionMatrix();
}

function setView(name) {
  if (!model) return;
  setAutoRotate(false);
  const directions = {
    front: [0, -1, 0], back: [0, 1, 0], top: [0, -0.001, 1], bottom: [0, -0.001, -1],
  };
  const direction = new Vector3(...directions[name]).normalize();
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(direction, fitDistance);
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  controls.update();
  ui["view-label"].textContent = modelName(selected);
  requestRender();
}

function zoom(factor) {
  setAutoRotate(false);
  const offset = camera.position.clone().sub(controls.target);
  const distance = Math.min(controls.maxDistance, Math.max(controls.minDistance, offset.length() * factor));
  camera.position.copy(controls.target).add(offset.setLength(distance));
  controls.update();
  requestRender();
}

function orbit(horizontal, vertical) {
  setAutoRotate(false);
  const offset = camera.position.clone().sub(controls.target);
  const distance = offset.length();
  const phi = Math.max(0.001, Math.min(Math.PI - 0.001, Math.acos(offset.z / distance) + vertical));
  const theta = Math.atan2(offset.x, -offset.y) + horizontal;
  offset.set(Math.sin(phi) * Math.sin(theta), -Math.sin(phi) * Math.cos(theta), Math.cos(phi));
  camera.position.copy(controls.target).addScaledVector(offset, distance);
  controls.update();
  requestRender();
}

function resize() {
  const width = ui.viewport.clientWidth;
  const height = ui.viewport.clientHeight;
  if (!width || !height) return;
  const ratio = camera.position.distanceTo(controls.target) / fitDistance;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  if (model) {
    calculateFit();
    const offset = camera.position.clone().sub(controls.target);
    camera.position.copy(controls.target).add(offset.setLength(
      Math.max(controls.minDistance, Math.min(controls.maxDistance, fitDistance * ratio)),
    ));
    controls.update();
  } else {
    camera.updateProjectionMatrix();
  }
  requestRender();
}

const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0, flatShading: true });
addSeamShading(material);

function buildModel(data, validation) {
  const root = new Group();
  root.name = data.key;
  root.scale.setScalar(MM_TO_WORLD);
  const meshes = new Map();
  const offsets = new Map();
  const matrix = new Matrix4();
  const colors = data.palette.map(([, rgba]) => new Color().setRGB(...rgba.slice(0, 3), LinearSRGBColorSpace));
  const centerMm = data.boundsMm.min.map((value, axis) => (value + data.boundsMm.max[axis]) / 2);
  let radiusSquaredMm = 0;
  try {
    for (const [nx, ny] of FOOTPRINTS) {
      const key = `${nx}x${ny}`;
      const count = validation.footprints[key];
      if (!count) continue;
      const mesh = new InstancedMesh(geometries.get(key), material, count);
      mesh.name = key;
      mesh.userData.footprint = [nx, ny];
      meshes.set(key, mesh);
      offsets.set(key, 0);
      root.add(mesh);
    }
    for (const [x, y, nx, ny, z, color] of data.parts) {
      const key = `${nx}x${ny}`;
      const mesh = meshes.get(key);
      const index = offsets.get(key);
      const tx = x * DIMENSIONS.pitchMm - data.diameterMm / 2;
      const ty = y * DIMENSIONS.pitchMm - data.diameterMm / 2;
      matrix.makeTranslation(tx, ty, z);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, colors[color]);
      offsets.set(key, index + 1);
      const box = mesh.geometry.boundingBox;
      const dx = Math.max(Math.abs(tx + box.min.x - centerMm[0]), Math.abs(tx + box.max.x - centerMm[0]));
      const dy = Math.max(Math.abs(ty + box.min.y - centerMm[1]), Math.abs(ty + box.max.y - centerMm[1]));
      const dz = Math.max(Math.abs(z + box.min.z - centerMm[2]), Math.abs(z + box.max.z - centerMm[2]));
      radiusSquaredMm = Math.max(radiusSquaredMm, dx * dx + dy * dy + dz * dz);
    }
    for (const mesh of root.children) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
    }
    root.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(root);
    for (const key of ["min", "max"]) {
      requireValue(bounds[key].toArray().every((value, axis) =>
        Math.abs(value / MM_TO_WORLD - data.boundsMm[key][axis]) < 0.0001),
      `Rendered ${key} bounds disagree with the canonical placements`);
    }
    return { root, bounds, radius: Math.sqrt(radiusSquaredMm) * MM_TO_WORLD };
  } catch (error) {
    for (const mesh of root.children) mesh.dispose();
    throw error;
  }
}

async function selectModel() {
  const request = ++generation;
  setAutoRotate(false);
  status = "loading";
  stopFrames();
  controls.enabled = false;
  ui.loading.hidden = false;
  ui.viewport.setAttribute("aria-busy", "true");
  ui["loading-message"].textContent = text.loadingMessage;
  document.documentElement.dataset.viewerState = "loading";
  ui["model-status"].textContent = text.loading;
  ui["model-name"].textContent = text.loading;
  for (const id of ["brick-count", "dimensions", "brick-types", "rib-count"]) ui[id].textContent = "—";
  for (const control of document.querySelectorAll("[data-control]")) control.disabled = true;
  disposeModel();
  selected = null;
  worldBounds = null;
  renderer.clear();
  globalThis.haroBoot.step("await-layout", text.layoutWait);
  // Let the loading state paint before parsing and uploading the selected model.
  await new Promise((resolve, reject) => requestAnimationFrame(() => {
    try {
      setTimeout(resolve, 0);
    } catch (error) {
      reject(error);
    }
  }));
  if (request !== generation || status === "error") return;
  try {
    const key = `${ui.style.value}-${ui.size.value}`;
    globalThis.haroBoot.step("data", phrase(text.dataCheck, { key }));
    const element = document.getElementById(`data-${key}`);
    requireValue(element, phrase(text.missingData, { key }));
    const data = JSON.parse(element.textContent);
    requireValue(data.key === key, "Selected model and embedded data disagree");
    const validation = validatePacked(data);
    globalThis.haroBoot.step("instances", phrase(text.placing, { count: number(data.parts.length) }));
    const built = buildModel(data, validation);
    model = built.root;
    worldBounds = built.bounds;
    radius = built.radius;
    worldBounds.getCenter(center);
    // Retain metadata, not another full placement array or any of the other seven scenes.
    const { parts, palette, ...metadata } = data;
    selected = metadata;
    scene.add(model);
    calculateFit();
    status = "ready";
    controls.enabled = true;
    setView("front");
    ui["model-name"].textContent = modelName(data);
    ui["brick-count"].textContent = phrase(text.count, { count: number(data.parts.length) });
    ui.dimensions.textContent = `${data.boundsMm.size.map(value => value.toFixed(1)).join(" × ")} mm`;
    ui["brick-types"].textContent = phrase(text.types, {
      long: number(validation.brickTypes["2x4"]), square: number(validation.brickTypes["2x2"]),
    });
    ui["rib-count"].textContent = phrase(text.ribs, { count: number(validation.colors.rib) });
    ui["model-status"].textContent = text.status;
    const languageLink = document.getElementById("language-switch");
    languageLink.href = `${languageLink.dataset.path}?style=${data.style}&size=${data.diameterMm}`;
    for (const control of document.querySelectorAll("[data-control]")) control.disabled = false;
    globalThis.haroBoot.step("await-first-frame", text.frameWait);
    requestRender();
  } catch (error) {
    disposeModel();
    fail(error, text.opLoad);
  }
}

function diagnostics() {
  return {
    status, key: selected?.key, renderedFrames,
    autoRotateRequested: autoRotate,
    autoRotateActive: autoRotate && !document.hidden && status === "ready",
    hidden: document.hidden,
    brickCount: model?.children.reduce((sum, mesh) => sum + mesh.count, 0) || 0,
    modelCount: scene.children.filter(child => child instanceof Group).length,
    meshCount: model?.children.length || 0,
    rootScale: model?.scale.toArray(),
    boundsMm: worldBounds && Object.fromEntries(["min", "max"].map(key =>
      [key, worldBounds[key].toArray().map(value => value / MM_TO_WORLD)])),
    camera: {
      position: camera.position.toArray(), target: controls.target.toArray(), up: camera.up.toArray(),
      distance: camera.position.distanceTo(controls.target), fitDistance,
      near: camera.near, far: camera.far, minDistance: controls.minDistance, maxDistance: controls.maxDistance,
      projection: camera.projectionMatrix.toArray(), view: camera.matrixWorldInverse.toArray(),
    },
    renderer: {
      calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
      contextLost: renderer.getContext().isContextLost(),
    },
  };
}

async function start() {
  globalThis.haroBoot.step("index", text.index);
  const indexElement = document.getElementById("model-index");
  requireValue(indexElement, text.missingIndex);
  const index = JSON.parse(indexElement.textContent);
  requireValue(index.length === 8 && new Set(index.map(entry => entry.key)).size === 8
    && Object.keys(STYLES).every(style => DIAMETERS.every(diameter =>
      index.some(entry => entry.key === `${style}-${diameter}`))), "Eight-model index is invalid");
  const query = new URLSearchParams(location.search);
  if (query.has("style") || query.has("size")) {
    const key = `${query.get("style") || "simple"}-${query.get("size") || "400"}`;
    const entry = index.find(item => item.key === key);
    requireValue(entry, phrase(text.invalidModel, { key }));
    ui.style.value = entry.style;
    ui.size.value = String(entry.diameterMm);
  }
  globalThis.haroBoot.step("webgl", text.webgl);
  renderer = new WebGLRenderer({ antialias: true, alpha: false });
  const gl = renderer.getContext();
  globalThis.haroBoot.context(gl.getParameter(gl.VERSION));
  globalThis.haroBoot.step("renderer", text.renderer);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor("#e6ece8");
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    throw new Error(`WebGL shader failed: ${gl.getProgramInfoLog(program)} ${gl.getShaderInfoLog(vertex)} ${gl.getShaderInfoLog(fragment)}`);
  };
  const canvas = renderer.domElement;
  canvas.id = "model-canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", text.canvasLabel);
  canvas.setAttribute("aria-describedby", "viewer-help");
  canvas.addEventListener("webglcontextlost", owned(text.opContext, event => {
    event.preventDefault();
    fail(new Error(text.contextLost), text.opContext);
  }));
  ui.viewport.prepend(canvas);
  scene = new Scene();
  camera = new PerspectiveCamera(42, 1, 0.001, 100);
  camera.up.set(0, 0, 1);
  camera.position.set(0, -1, 0);
  controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = false;
  controls.minPolarAngle = 0.001;
  controls.maxPolarAngle = Math.PI - 0.001;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 1.2;
  controls.touches.ONE = TOUCH.ROTATE;
  controls.touches.TWO = TOUCH.DOLLY_PAN;
  controls.addEventListener("change", owned(text.opRenderRequest, requestRender));
  controls.addEventListener("start", owned(text.opManual, () => setAutoRotate(false)));
  const hemisphere = new HemisphereLight(0xffffff, 0x79877d, 1.4);
  hemisphere.position.set(0, 0, 1);
  scene.add(hemisphere);
  const key = new DirectionalLight(0xfffaf3, 2);
  key.position.set(-2, -3, 4);
  scene.add(key);
  const fill = new DirectionalLight(0xe6f0ff, 0.9);
  fill.position.set(3, 1, -1);
  scene.add(fill);
  globalThis.haroBoot.step("geometry", text.geometry);
  for (const [nx, ny] of FOOTPRINTS) geometries.set(`${nx}x${ny}`, brickGeometry(nx, ny));
  resize();
  new ResizeObserver(owned(text.opResize, resize)).observe(ui.viewport);
  ui.style.addEventListener("change", owned(text.opStyle, selectModel));
  ui.size.addEventListener("change", owned(text.opSize, selectModel));
  ui["auto-rotate"].addEventListener("click", owned(text.opAuto, () => setAutoRotate(!autoRotate)));
  for (const button of document.querySelectorAll("[data-view]")) {
    button.addEventListener("click", owned(text.opView, () => setView(button.dataset.view)));
  }
  document.getElementById("zoom-in").addEventListener("click", owned(text.opZoomIn, () => zoom(0.8)));
  document.getElementById("zoom-out").addEventListener("click", owned(text.opZoomOut, () => zoom(1.25)));
  canvas.addEventListener("keydown", owned(text.opKeyboard, event => {
    if (status !== "ready") return;
    const step = Math.PI / 18;
    const actions = {
      ArrowLeft: () => orbit(-step, 0), ArrowRight: () => orbit(step, 0),
      ArrowUp: () => orbit(0, -step), ArrowDown: () => orbit(0, step),
      "+": () => zoom(0.8), "=": () => zoom(0.8), "-": () => zoom(1.25),
      Home: () => setView("front"),
    };
    if (actions[event.key]) {
      event.preventDefault();
      actions[event.key]();
    }
  }));
  document.addEventListener("visibilitychange", owned(text.opVisibility, () => {
    stopFrames();
    if (!document.hidden) requestRender();
  }));
  // Read-only snapshots let the offline checks inspect actual GPU inputs, not metadata alone.
  globalThis.haroViewer = Object.freeze({
    getState: diagnostics,
    inspectModel: () => model ? {
      ...diagnostics(),
      meshes: model.children.map(mesh => ({
        footprint: [...mesh.userData.footprint], count: mesh.count,
        matrixWorld: mesh.matrixWorld.toArray(),
        matrices: Array.from(mesh.instanceMatrix.array),
        colors: Array.from(mesh.instanceColor.array),
        positions: Array.from(mesh.geometry.getAttribute("position").array),
        indices: Array.from(mesh.geometry.index.array),
      })),
    } : null,
  });
  await selectModel();
}

globalThis.haroBoot.run(text.opInitial, start);
