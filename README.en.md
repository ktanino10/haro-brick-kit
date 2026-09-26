# Haro: a brick-built exterior concept study

**English | [日本語](README.md)**

The GitHub Pages URL will be listed here after deployment is verified. Open `docs/en/index.html` for the local site.

An unofficial personal study comparing Basic and Detailed (blue eyes) styles in
40, 60, 80 and 100 cm classes, using unchanged physical brick dimensions.
The renders, bounds, counts and 360° views use the same eight placement datasets.

**Exterior concept only — NOT printable or assembly-ready CAD.**
Underside cavities, clutch fit, strength, support, build order and printing are unverified.
Manufacturing design is on hold. No STL/3MF files, assembly instructions,
weight estimates or print-time estimates are provided.

## What is included

- Eight concepts at equal display size or equal physical scale, plus 100 cm-class front renders.
- True 3D orbit and zoom using mouse drag/wheel or one-finger/pinch touch gestures.
- Front, back, top and underside views, reset, and optional start/stop auto-rotation.
- Japanese and English controls, loading/error messages, diagnostics and warnings.

All concepts use **8 mm pitch, 9.6 mm body height, and studs 4.8 mm in diameter × 1.8 mm high**.
Only 2×2 and 2×4 footprints are used; the whole model is not enlarged to scale up the bricks.
The 60 cm class targets 608 mm; the 100 cm class targets 992 mm.
Counts include the shell and internal ribs, and exclude a stand, hinges, spares and fit coupons.

| Style | Size class | Width × depth × height (including studs) | Total |
| --- | --- | --- | ---: |
| Basic | 40 cm class | 399.8 × 399.8 × 405.0 mm | 2,476 |
| Basic | 60 cm class | 607.8 × 607.8 × 606.6 mm | 5,703 |
| Basic | 80 cm class | 799.8 × 799.8 × 798.6 mm | 10,124 |
| Basic | 100 cm class | 991.8 × 991.8 × 990.6 mm | 15,733 |
| Detailed (blue eyes) | 40 cm class | 399.8 × 399.8 × 405.0 mm | 2,498 |
| Detailed (blue eyes) | 60 cm class | 607.8 × 607.8 × 606.6 mm | 5,753 |
| Detailed (blue eyes) | 80 cm class | 799.8 × 799.8 × 798.6 mm | 10,146 |
| Detailed (blue eyes) | 100 cm class | 991.8 × 991.8 × 990.6 mm | 15,869 |

## Offline use

Use “Save the standalone 360° HTML” on the site, or download and extract this repository as a ZIP.
Open `docs/en/index.html` for English or `docs/index.html` for Japanese.
The `viewer360.html` in each folder is the 360° viewer.
Each viewer embeds the library and all eight models: no CDN, login, local server or end-user installation.
The HTML works on its own for 3D; comparison and language links require their companion pages.
A WebGL 2-capable browser is required. Interaction speed depends on the device.

## Source and reproducible build

`data/` is the basis for placements, dimensions, palettes and counts; `src/` contains rendering and translations;
`scripts/` contains build/check tools; only `docs/` is published by GitHub Pages.
Three shared brick geometries use GPU instancing, and only the selected model is rendered.
Z is up, the front is −Y, and the only mm-to-world conversion is a fixed 0.001 scale at the model root.
Studs use the same 12-sided envelopes as the original concept renders, not manufacturing clutch CAD.

For development only (not needed to view the files):

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run test:unit
```

`npm run test:browser` uses Playwright Core.
Set `HARO_BROWSER_PATH` to an installed Chromium-family browser executable.
Set `HARO_TEST_OUTPUT` for private test artifacts; the default `test-output/` is not published.
Set `HARO_LIVE_URL` to run the same checks against the deployed site.
Normal browser profiles and GPU settings are not changed.

Unhandled page-wide exceptions are kept separate from viewer-owned failures.
A host notification-permission rejection does not erase the model; genuine boot, placement,
rendering and control failures remain explicit. Diagnostics stay on the page and are not transmitted.
Hidden-tab checks use visibility-event emulation in headless testing, not physical-phone performance certification.

## Publication scope and rights

Original reference images are not redistributed. Published images are CGs generated from this study's placements,
with private image metadata removed. Private logs, diagnostic screenshots, working Blender files,
caches and machine-specific paths are not included.

Character, franchise and trademark rights belong to their respective holders.
This is not an official product, endorsement, affiliation, compatibility claim or toy certification.
No blanket license or sublicense to the character, artwork or model data is granted.
See [rights and unofficial-project notices](RIGHTS.md) and [third-party library licenses](THIRD_PARTY_NOTICES.txt).
