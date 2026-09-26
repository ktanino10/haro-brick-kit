import {
  BoxGeometry, CylinderGeometry, Float32BufferAttribute,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { DIMENSIONS } from "./data.mjs";

// Geometry and instance translations stay in mm. Only the model root uses this conversion.
export const MM_TO_WORLD = 0.001;

export function brickGeometry(nx, ny) {
  const { pitchMm, bodyHeightMm, bodyGapMm, studDiameterMm, studHeightMm } = DIMENSIONS;
  const width = nx * pitchMm - bodyGapMm;
  const depth = ny * pitchMm - bodyGapMm;
  const body = new BoxGeometry(width, depth, bodyHeightMm);
  body.translate(nx * pitchMm / 2, ny * pitchMm / 2, bodyHeightMm / 2);
  const uv = body.getAttribute("uv");
  const edgeDistances = [];
  const faceSizes = [[bodyHeightMm, depth], [bodyHeightMm, depth],
    [width, bodyHeightMm], [width, bodyHeightMm], [width, depth], [width, depth]];
  for (let i = 0; i < uv.count; i++) {
    const [w, h] = faceSizes[Math.floor(i / 4)];
    const u = uv.getX(i);
    const v = uv.getY(i);
    edgeDistances.push(u * w, (1 - u) * w, v * h, (1 - v) * h);
  }
  body.setAttribute("edgeDistances", new Float32BufferAttribute(edgeDistances, 4));
  const components = [body];
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      // The canonical Blender envelopes use 12-sided, open-bottom studs.
      const stud = new CylinderGeometry(studDiameterMm / 2, studDiameterMm / 2, studHeightMm, 12);
      const bottom = stud.groups[2];
      stud.setIndex(Array.from(stud.index.array.slice(0, bottom.start)));
      stud.clearGroups();
      stud.rotateX(Math.PI / 2);
      stud.translate(pitchMm / 2 + x * pitchMm, pitchMm / 2 + y * pitchMm,
        bodyHeightMm + studHeightMm / 2);
      stud.setAttribute("edgeDistances", new Float32BufferAttribute(
        new Float32Array(stud.getAttribute("position").count * 4).fill(100), 4,
      ));
      components.push(stud);
    }
  }
  const merged = mergeGeometries(components);
  for (const component of components) component.dispose();
  if (!merged) throw new Error("Brick geometry could not be merged");
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

export function addSeamShading(material) {
  // A thin edge shade reveals touching rows without changing the 9.6 mm geometry or palette.
  material.onBeforeCompile = shader => {
    shader.vertexShader = `attribute vec4 edgeDistances;
varying vec4 vEdgeDistances;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>",
      "#include <begin_vertex>\nvEdgeDistances = edgeDistances;");
    shader.fragmentShader = `varying vec4 vEdgeDistances;\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `
      #include <color_fragment>
      float edge = min(min(vEdgeDistances.x, vEdgeDistances.y), min(vEdgeDistances.z, vEdgeDistances.w));
      float seam = 1.0 - smoothstep(0.0, 0.12, edge);
      diffuseColor.rgb *= 1.0 - 0.28 * seam;
    `);
  };
  material.customProgramCacheKey = () => "haro-brick-seams-v1";
}
