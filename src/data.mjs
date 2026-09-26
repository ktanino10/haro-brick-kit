export const DIMENSIONS = Object.freeze({
  pitchMm: 8,
  bodyHeightMm: 9.6,
  bodyGapMm: 0.2,
  studDiameterMm: 4.8,
  studHeightMm: 1.8,
});

export const STYLES = Object.freeze({
  simple: "ベーシック版",
  mechanical: "ディテール版",
});
export const DIAMETERS = Object.freeze([400, 608, 800, 992]);
export const FOOTPRINTS = Object.freeze([[2, 2], [2, 4], [4, 2]]);
export const STATUS = "CONCEPT_ONLY_NOT_PRINTABLE";
export const TUPLE_FIELDS = Object.freeze(["x", "y", "nx", "ny", "base_z_mm", "palette_index"]);

export function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function near(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-7;
}

function sameCounts(actual, expected, name) {
  requireValue(expected && typeof expected === "object", `${name}: missing counts`);
  requireValue(
    Object.keys(actual).length === Object.keys(expected).length
      && Object.entries(actual).every(([key, value]) => value === expected[key]),
    `${name}: counts do not match placements`,
  );
}

export function placementBounds(parts, diameterMm) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const [x, y, nx, ny, z] of parts) {
    const lower = [x * DIMENSIONS.pitchMm - diameterMm / 2 + DIMENSIONS.bodyGapMm / 2,
      y * DIMENSIONS.pitchMm - diameterMm / 2 + DIMENSIONS.bodyGapMm / 2, z];
    const upper = [(x + nx) * DIMENSIONS.pitchMm - diameterMm / 2 - DIMENSIONS.bodyGapMm / 2,
      (y + ny) * DIMENSIONS.pitchMm - diameterMm / 2 - DIMENSIONS.bodyGapMm / 2,
      z + DIMENSIONS.bodyHeightMm + DIMENSIONS.studHeightMm];
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], lower[axis]);
      max[axis] = Math.max(max[axis], upper[axis]);
    }
  }
  return { min, max, size: max.map((value, axis) => value - min[axis]) };
}

export function validatePacked(model) {
  requireValue(model?.schemaVersion === 1, "Unsupported embedded data schema");
  requireValue(model.status === STATUS, "Concept status is missing");
  requireValue(STYLES[model.style] === model.label, "Unknown style or label");
  requireValue(DIAMETERS.includes(model.diameterMm), "Unknown diameter");
  requireValue(model.key === `${model.style}-${model.diameterMm}`, "Model key mismatch");
  requireValue(
    Object.entries(DIMENSIONS).every(([key, value]) => model.dimensions?.[key] === value),
    "Physical brick dimensions must remain unchanged",
  );
  requireValue(Array.isArray(model.parts) && model.parts.length > 0, "No brick placements");
  requireValue(Array.isArray(model.palette) && model.palette.length > 0, "No palette");
  requireValue(model.summary?.layers === Math.round(model.diameterMm / DIMENSIONS.bodyHeightMm),
    "Invalid layer extent");
  const names = new Set();
  for (const [name, rgba] of model.palette) {
    requireValue(typeof name === "string" && !names.has(name), "Invalid palette name");
    requireValue(Array.isArray(rgba) && rgba.length === 4
      && rgba.every(value => Number.isFinite(value) && value >= 0 && value <= 1)
      && rgba[3] === 1, "Invalid or unsupported palette color");
    names.add(name);
  }
  const colors = {};
  const brickTypes = {};
  const footprints = {};
  const layers = Array(model.summary.layers).fill(0);
  let studCount = 0;
  for (const part of model.parts) {
    requireValue(Array.isArray(part) && part.length === 6, "Invalid placement tuple");
    const [x, y, nx, ny, z, color] = part;
    requireValue(Number.isInteger(x) && Number.isInteger(y), "Invalid XY grid position");
    requireValue(x >= 0 && y >= 0 && x + nx <= model.diameterMm / DIMENSIONS.pitchMm
      && y + ny <= model.diameterMm / DIMENSIONS.pitchMm, "Placement outside XY grid");
    requireValue(FOOTPRINTS.some(([a, b]) => nx === a && ny === b), "Unsupported footprint");
    requireValue(Number.isInteger(color) && color >= 0 && color < model.palette.length,
      "Invalid palette index");
    const layer = Math.round(z / DIMENSIONS.bodyHeightMm);
    requireValue(near(z, layer * DIMENSIONS.bodyHeightMm)
      && layer >= 0 && layer < layers.length, "Invalid Z placement");
    const name = model.palette[color][0];
    colors[name] = (colors[name] || 0) + 1;
    const type = `${Math.min(nx, ny)}x${Math.max(nx, ny)}`;
    brickTypes[type] = (brickTypes[type] || 0) + 1;
    const footprint = `${nx}x${ny}`;
    footprints[footprint] = (footprints[footprint] || 0) + 1;
    layers[layer]++;
    studCount += nx * ny;
  }
  const summary = model.summary;
  requireValue(summary.target_diameter_mm === model.diameterMm, "Target diameter mismatch");
  requireValue(summary.brick_count === model.parts.length, "Brick count mismatch");
  requireValue(summary.stud_cell_count === studCount, "Stud count mismatch");
  requireValue(summary.horizontal_stud_positions * DIMENSIONS.pitchMm === model.diameterMm,
    "Grid diameter mismatch");
  requireValue(summary.bricks_per_layer?.length === layers.length
    && layers.every((n, i) => n === summary.bricks_per_layer[i]), "Layer count mismatch");
  sameCounts(colors, summary.colors, "Colors");
  sameCounts(brickTypes, summary.brick_types, "Brick types");
  const bounds = placementBounds(model.parts, model.diameterMm);
  requireValue(summary.body_bbox_mm?.length === 3
    && bounds.size.every((v, i) => near(v, summary.body_bbox_mm[i])), "Summary bounds mismatch");
  requireValue(["min", "max", "size"].every(key => model.boundsMm?.[key]?.length === 3
    && bounds[key].every((v, i) => near(v, model.boundsMm[key][i]))), "Embedded bounds mismatch");
  return { bounds, footprints, colors, brickTypes, studCount };
}

export function packStudy(study, indexEntry, sourceSha256) {
  requireValue(study?.status === STATUS, "Canonical concept status mismatch");
  requireValue(study.label === STYLES[study.style], "Canonical style label mismatch");
  requireValue(study.style === indexEntry.style, "Index style mismatch");
  requireValue(study.sizes?.length === 1, "Each canonical study must contain exactly one size");
  for (const [key, value] of Object.entries({
    pitch_mm: DIMENSIONS.pitchMm,
    brick_body_height_mm: DIMENSIONS.bodyHeightMm,
    stud_diameter_mm: DIMENSIONS.studDiameterMm,
    stud_height_mm: DIMENSIONS.studHeightMm,
  })) {
    requireValue(study[key] === value, `Canonical ${key} changed`);
  }
  const { summary, parts } = study.sizes[0];
  requireValue(summary.target_diameter_mm === indexEntry.diameter_mm, "Index diameter mismatch");
  requireValue(JSON.stringify(summary) === JSON.stringify(indexEntry.summary), "Index summary mismatch");
  const palette = Object.entries(study.palette);
  const ids = new Set();
  const tuples = parts.map(part => {
    requireValue(typeof part.id === "string" && !ids.has(part.id), "Missing or duplicate brick ID");
    ids.add(part.id);
    requireValue(part.height_mm === DIMENSIONS.bodyHeightMm, "Brick body height changed");
    requireValue(Number.isInteger(part.layer) && part.layer >= 0, "Invalid canonical layer");
    const z = part.base_z_mm ?? part.layer * DIMENSIONS.bodyHeightMm;
    requireValue(near(z, part.layer * DIMENSIONS.bodyHeightMm), "Base Z and layer disagree");
    return [part.x, part.y, part.nx, part.ny, z, palette.findIndex(([name]) => name === part.color)];
  });
  const model = {
    schemaVersion: 1,
    key: `${study.style}-${indexEntry.diameter_mm}`,
    style: study.style,
    label: study.label,
    diameterMm: indexEntry.diameter_mm,
    status: study.status,
    dimensions: DIMENSIONS,
    summary,
    source: `${study.style}/${indexEntry.diameter_mm}/study.json`,
    sourceSha256,
    palette,
    boundsMm: placementBounds(tuples, indexEntry.diameter_mm),
    parts: tuples,
  };
  validatePacked(model);
  return model;
}
