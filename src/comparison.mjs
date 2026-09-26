export function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function phrase(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) throw new Error(`Missing translation value: ${key}`);
    return String(values[key]);
  });
}

export function comparisonPage(locale, models, repository) {
  const t = locale.comparison;
  const ui = locale.ui;
  const h = escapeHtml;
  const n = value => value.toLocaleString(locale.numberLocale);
  const assets = locale.language === "ja" ? "assets/" : "../assets/";
  const languagePath = locale.language === "ja" ? "en/index.html" : "../index.html";
  const modelName = model => phrase(locale.runtime.modelName, {
    style: locale.styles[model.style], size: model.summary.size_class_cm,
  });
  const sections = ["simple", "mechanical"].map(style => `<section><h2>${h(locale.styles[style])}</h2><div class="grid">${
    models.filter(model => model.style === style).map(model => {
      const s = model.summary;
      return `<article data-model="${model.key}">
<div class="stage"><img class="model" style="--relative:${model.diameterMm / 992}" src="${assets}${model.key}.png" alt="${h(modelName(model))}"></div>
<div class="caption"><h3>${h(phrase(t.class, { size: s.size_class_cm }))}</h3>
<strong>${h(phrase(t.bricks, { count: n(s.brick_count) }))}</strong>
<p>${h(t.dimensions)}: ${s.body_bbox_mm.map(value => value.toFixed(1)).join(" × ")} mm<br>
2×4: ${n(s.brick_types["2x4"])} / 2×2: ${n(s.brick_types["2x2"])}</p>
<a href="viewer360.html?style=${model.style}&amp;size=${model.diameterMm}">${h(t.eachViewer)}</a></div></article>`;
    }).join("")
  }</div></section>`).join("");
  const rows = models.map(model => `<tr><td>${h(locale.styles[model.style])}</td>
<td>${h(phrase(t.class, { size: model.summary.size_class_cm }))}</td>
<td>${model.summary.body_bbox_mm.map(value => value.toFixed(1)).join(" × ")} mm</td>
<td>${n(model.summary.brick_count)}</td><td>${n(model.summary.colors.rib)}</td></tr>`).join("");
  const fronts = models.filter(model => model.diameterMm === 992).map(model =>
    `<figure><img src="${assets}${model.key}-front.png" alt="${h(modelName(model))}"><figcaption>${h(modelName(model))}</figcaption></figure>`).join("");
  return `<!doctype html>
<html lang="${locale.language}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'">
<link rel="icon" href="data:,"><title>${h(t.title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f1f5f2;color:#183326;font:16px/1.75 system-ui,sans-serif}
main{max-width:1800px;margin:auto;padding:24px 24px 64px}nav{display:flex;justify-content:space-between;gap:12px;align-items:center}
h1{font-size:clamp(25px,3.5vw,42px);line-height:1.4}h2{margin:28px 0 14px}
a{color:#28623c;text-underline-offset:.2em}.badge{border-radius:20px;background:#deeadb;padding:4px 12px;font-size:12px}
.viewer-link{display:inline-block;padding:10px 18px;border-radius:9px;background:#284f35;color:white;text-decoration:none;font-weight:600}
.controls{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}button{font:inherit;cursor:pointer;border-radius:9px;border:1px solid #69816d;padding:9px 16px;background:white;color:#23482d}
button[aria-pressed=true]{background:#284f35;color:white}button:focus-visible,a:focus-visible{outline:3px solid #70a77c;outline-offset:3px}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}article{background:white;border-radius:15px;overflow:hidden;border:1px solid #d3e0d5}
.stage{aspect-ratio:1;background:#e2e5e3;overflow:hidden;position:relative}.model{width:100%;height:100%;object-fit:contain;display:block;transform-origin:50% 89%;transition:transform .3s}
.physical .model{transform:scale(var(--relative))}.caption{padding:14px 18px}.caption h3{margin:0;font-size:21px}.caption strong{font-size:28px}.caption p{font-size:13px;color:#4c6253}
.notice{background:#fff6df;border-left:5px solid #c8942d;padding:16px 20px;margin:24px 0}.muted{color:#536959;font-size:14px}
.scroll{overflow:auto}table{width:100%;border-collapse:collapse;background:white;white-space:nowrap}th,td{padding:10px 15px;border-bottom:1px solid #d4dfd6;text-align:left}th{background:#e3ece4}
details{background:white;padding:15px;border-radius:12px;margin-top:18px}summary{font-weight:600;cursor:pointer}.front-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
figure{margin:18px 0}figure img{width:100%;height:auto;display:block}figcaption{font-size:13px;color:#536959}
@media(max-width:1100px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:520px){main{padding:18px 12px}.grid,.front-grid{grid-template-columns:1fr}nav{font-size:14px}.badge{font-size:11px}}
@media(prefers-reduced-motion:reduce){.model{transition:none}}
</style></head><body><main>
<nav aria-label="${h(ui.navigationLabel)}"><span class="badge">${h(ui.badge)}</span><a id="language-switch" href="${languagePath}" lang="${locale.otherLanguage}">${h(locale.otherName)}</a></nav>
<h1>${h(t.title)}</h1><p>${h(t.intro)}</p><p><strong>${h(t.sameBricks)}</strong></p><p class="muted">${h(t.proportional)}</p>
<p><a class="viewer-link" href="viewer360.html">${h(t.viewer)}</a></p>
<div class="controls"><button id="normalized" aria-pressed="true">${h(t.normalized)}</button><button id="physical" aria-pressed="false">${h(t.physical)}</button></div>
<p id="mode-hint" class="muted" aria-live="polite">${h(t.normalizedHint)}</p>
${sections}
<div class="notice"><strong>${h(ui.warning)}</strong><br>${h(ui.warningBody)}<br>${h(t.thickness)}</div>
<section><h2>${h(t.tableTitle)}</h2><div class="scroll"><table><thead><tr>
${[t.style, t.size, t.bounds, t.total, t.internal].map(label => `<th>${h(label)}</th>`).join("")}
</tr></thead><tbody>${rows}</tbody></table></div><p class="muted">${h(ui.classes)}</p></section>
<details><summary>${h(t.fronts)}</summary><div class="front-grid">${fronts}</div></details>
<p class="muted">${h(t.sourceNote)}</p>
<p class="muted">${h(ui.unofficial)} <a href="${repository}/blob/main/RIGHTS.md">${h(ui.rights)}</a></p>
<p><a href="viewer360.html" download>${h(ui.download)}</a> · <a href="${repository}">${h(ui.source)}</a></p>
</main><script>
const buttons=[document.getElementById("normalized"),document.getElementById("physical")];
function setMode(physical){
 document.body.classList.toggle("physical",physical);
 buttons[0].setAttribute("aria-pressed",String(!physical));
 buttons[1].setAttribute("aria-pressed",String(physical));
 document.getElementById("mode-hint").textContent=physical?${JSON.stringify(t.physicalHint)}:${JSON.stringify(t.normalizedHint)};
}
buttons[0].addEventListener("click",()=>setMode(false));
buttons[1].addEventListener("click",()=>setMode(true));
</script></body></html>\n`;
}
