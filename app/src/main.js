// Neon Poster Lab — a GTA-style multi-panel cover art maker.
// Everything runs locally in the browser: photos are read from the person's own machine,
// the poster is drawn on a canvas, and the PNG export is generated on the spot.
// No libraries, no build step, no network requests.

'use strict';

/* ------------------------------------------------------------------ data */

const POSTER_SIZES = [
  { id: 'square', label: '1080 × 1080', w: 1080, h: 1080 },
  { id: 'portrait', label: '1080 × 1350', w: 1080, h: 1350 },
  { id: 'landscape', label: '1920 × 1080', w: 1920, h: 1080 },
];

// Panel layouts as fractions of the poster. Each entry is [x, y, w, h] in 0..1 space;
// the renderer insets every panel by the poster gap so the panels read as a printed poster.
const LAYOUTS = [
  {
    id: 'quad',
    label: 'Quad grid',
    panels: [
      [0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5],
      [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5],
    ],
  },
  {
    id: 'hero',
    label: 'Hero + two',
    panels: [
      [0, 0, 0.58, 1], [0.58, 0, 0.42, 0.5], [0.58, 0.5, 0.42, 0.5],
    ],
  },
  {
    id: 'strips',
    label: 'Three strips',
    panels: [
      [0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1],
    ],
  },
  {
    id: 'banner',
    label: 'Banner + two',
    panels: [
      [0, 0, 1, 0.56], [0, 0.56, 0.5, 0.44], [0.5, 0.56, 0.5, 0.44],
    ],
  },
];

// One-click colour grades. `filter` is a canvas filter string applied while each photo is
// drawn; `wash` is a two-stop gradient laid over the whole poster afterwards.
const GRADES = [
  {
    id: 'sunset',
    label: 'Vice sunset',
    filter: 'saturate(1.5) contrast(1.12) sepia(0.28) brightness(1.03)',
    wash: ['rgba(255,150,64,0.30)', 'rgba(140,24,110,0.38)'],
    washAngle: 'vertical',
  },
  {
    id: 'neon',
    label: 'Neon night',
    filter: 'saturate(1.75) contrast(1.28) hue-rotate(-14deg) brightness(0.99)',
    wash: ['rgba(0,229,255,0.22)', 'rgba(255,0,170,0.30)'],
    washAngle: 'diagonal',
  },
  {
    id: 'teal',
    label: 'Teal & orange',
    filter: 'saturate(1.32) contrast(1.16) brightness(1.01)',
    wash: ['rgba(0,128,140,0.26)', 'rgba(255,122,26,0.26)'],
    washAngle: 'vertical',
  },
  {
    id: 'clean',
    label: 'Clean print',
    filter: 'saturate(1.08) contrast(1.05)',
    wash: ['rgba(255,255,255,0.05)', 'rgba(10,8,24,0.16)'],
    washAngle: 'vertical',
  },
];

const TITLE_FONT = '"Arial Black", "Archivo Black", Impact, "Helvetica Neue", Arial, sans-serif';
const SUB_FONT = '"Helvetica Neue", Arial, sans-serif';
const SAMPLES = { boulevard: 'samples/boulevard.jpg', pier: 'samples/pier.jpg' };
const MAX_PHOTOS = 4;

/* ------------------------------------------------------------------ state */

const state = {
  photos: [],            // { img, name } — up to MAX_PHOTOS
  activePhoto: 0,        // photo slot chosen in the Photos group
  layoutId: 'quad',
  panels: [],            // { photo: index|null, zoom, ox, oy } — one per layout panel
  selectedPanel: 0,
  gradeId: 'sunset',
  gradeStrength: 0.8,
  sizeId: 'square',
  caption: { title: 'VICE CITY NIGHTS', subtitle: 'LEONIDA • EST. 2026', scale: 1, pos: 'bottom' },
};

function layoutById(id) { return LAYOUTS.find((l) => l.id === id) || LAYOUTS[0]; }
function gradeById(id) { return GRADES.find((g) => g.id === id) || GRADES[0]; }
function sizeById(id) { return POSTER_SIZES.find((s) => s.id === id) || POSTER_SIZES[0]; }

function freshPanel() { return { photo: null, zoom: 1, ox: 0, oy: 0 }; }

/** Rebuilds the panel list for the current layout, keeping photos where panels survive. */
function syncPanels() {
  const count = layoutById(state.layoutId).panels.length;
  const next = [];
  for (let i = 0; i < count; i++) next.push(state.panels[i] || freshPanel());
  state.panels = next;
  if (state.selectedPanel >= count) state.selectedPanel = 0;
}

/* ------------------------------------------------------------- geometry */

/** Panel rectangles in poster pixels: layout fractions inset by the poster gap. */
function panelRects(w, h) {
  const gap = Math.round(Math.min(w, h) * 0.012);
  return layoutById(state.layoutId).panels.map(([fx, fy, fw, fh]) => ({
    x: Math.round(fx * w) + gap,
    y: Math.round(fy * h) + gap,
    w: Math.round(fw * w) - gap * 2,
    h: Math.round(fh * h) - gap * 2,
  }));
}

/** Cover-fit draw box for a photo inside a panel, honouring zoom and pan offsets. */
function coverBox(img, rect, panel) {
  const scale = Math.max(rect.w / img.naturalWidth, rect.h / img.naturalHeight) * panel.zoom;
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  const slackX = dw - rect.w;
  const slackY = dh - rect.h;
  const dx = rect.x - slackX * (0.5 + panel.ox);
  const dy = rect.y - slackY * (0.5 + panel.oy);
  return { dx, dy, dw, dh, slackX, slackY };
}

function clampPanel(panel) {
  panel.zoom = Math.min(3, Math.max(1, panel.zoom));
  panel.ox = Math.min(0.5, Math.max(-0.5, panel.ox));
  panel.oy = Math.min(0.5, Math.max(-0.5, panel.oy));
}

/* -------------------------------------------------------------- drawing */

function drawPanelPhoto(ctx, rect, panel, grade) {
  const photo = panel.photo !== null ? state.photos[panel.photo] : null;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  if (photo && photo.img.complete && photo.img.naturalWidth > 0) {
    const box = coverBox(photo.img, rect, panel);
    try { ctx.filter = grade.filter; } catch (err) { /* older canvas: overlays still grade */ }
    ctx.drawImage(photo.img, box.dx, box.dy, box.dw, box.dh);
    try { ctx.filter = 'none'; } catch (err) { /* ignore */ }
  } else {
    const g = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
    g.addColorStop(0, '#2b1d4e');
    g.addColorStop(0.55, '#5c2150');
    g.addColorStop(1, '#8a3b2e');
    ctx.fillStyle = g;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `700 ${Math.max(18, rect.w * 0.07)}px ${SUB_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ADD PHOTO', rect.x + rect.w / 2, rect.y + rect.h / 2);
  }
  ctx.restore();
}

function drawGradeWash(ctx, w, h, grade, strength) {
  if (strength <= 0) return;
  const grad = grade.washAngle === 'diagonal'
    ? ctx.createLinearGradient(0, 0, w, h)
    : ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, grade.wash[0]);
  grad.addColorStop(1, grade.wash[1]);
  ctx.save();
  ctx.globalAlpha = strength;
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function drawVignette(ctx, w, h, strength) {
  const r = Math.max(w, h) * 0.75;
  const grad = ctx.createRadialGradient(w / 2, h / 2, r * 0.45, w / 2, h / 2, r);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, `rgba(5,2,16,${0.38 * Math.max(0.35, strength)})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

/** Letterspaced text, drawn glyph by glyph so the tracking works on every canvas. */
function drawTrackedText(ctx, text, cx, y, tracking) {
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + tracking * Math.max(0, text.length - 1);
  let x = cx - total / 2;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  [...text].forEach((ch, i) => {
    ctx.fillText(ch, x, y);
    x += widths[i] + tracking;
  });
  ctx.textAlign = prevAlign;
}

/** The bold poster lettering: gradient-filled title with a dark keyline, tracked subtitle under it. */
function drawCaption(ctx, w, h) {
  const cap = state.caption;
  const title = (cap.title || '').trim().toUpperCase();
  const subtitle = (cap.subtitle || '').trim().toUpperCase();
  if (!title && !subtitle) return;

  const unit = Math.min(w, h);
  let titleSize = unit * 0.105 * cap.scale;
  ctx.font = `900 ${titleSize}px ${TITLE_FONT}`;
  const maxTitleW = w * 0.92;
  const measured = ctx.measureText(title).width * 0.86; // condensed via horizontal scale below
  if (measured > maxTitleW && measured > 0) titleSize *= maxTitleW / measured;
  const subSize = Math.max(13, titleSize * 0.30);
  const blockH = titleSize * 1.12 + (subtitle ? subSize * 1.9 : 0);

  let top;
  if (cap.pos === 'top') top = h * 0.045;
  else if (cap.pos === 'center') top = (h - blockH) / 2;
  else top = h - blockH - h * 0.045;

  // Soft dark band behind the lettering so it reads over any photo.
  const band = ctx.createLinearGradient(0, top - titleSize * 0.35, 0, top + blockH + titleSize * 0.3);
  band.addColorStop(0, 'rgba(8,4,20,0)');
  band.addColorStop(0.35, 'rgba(8,4,20,0.45)');
  band.addColorStop(1, 'rgba(8,4,20,0.62)');
  ctx.fillStyle = band;
  ctx.fillRect(0, top - titleSize * 0.35, w, blockH + titleSize * 0.65);

  ctx.save();
  ctx.translate(w / 2, 0);
  ctx.transform(0.86, 0, -0.06, 1, 0, 0); // condensed, slight forward lean
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  if (title) {
    ctx.font = `900 ${titleSize}px ${TITLE_FONT}`;
    const grad = ctx.createLinearGradient(0, top, 0, top + titleSize);
    grad.addColorStop(0, '#fff6d8');
    grad.addColorStop(0.45, '#ffd166');
    grad.addColorStop(0.72, '#ff7b54');
    grad.addColorStop(1, '#ff4d8d');
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(16,6,32,0.92)';
    ctx.lineWidth = titleSize * 0.16;
    ctx.strokeText(title, 0, top + titleSize);
    ctx.fillStyle = grad;
    ctx.fillText(title, 0, top + titleSize);
    // Thin bright keyline on top of the gradient for a printed-poster edge.
    ctx.strokeStyle = 'rgba(255,246,216,0.55)';
    ctx.lineWidth = Math.max(1, titleSize * 0.018);
    ctx.strokeText(title, 0, top + titleSize);
  }

  if (subtitle) {
    ctx.font = `700 ${subSize}px ${SUB_FONT}`;
    ctx.fillStyle = '#aef3ec';
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = subSize * 0.25;
    drawTrackedText(ctx, subtitle, 0, top + titleSize + subSize * 1.35, subSize * 0.32);
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

function drawSelection(ctx, rects) {
  const rect = rects[state.selectedPanel];
  if (!rect) return;
  ctx.save();
  ctx.strokeStyle = '#37e0d4';
  ctx.lineWidth = Math.max(3, rect.w * 0.008);
  ctx.setLineDash([14, 9]);
  ctx.strokeRect(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4);
  ctx.restore();
}

/** Draws the whole poster. `forExport` hides editor-only marks like the selection outline. */
function drawCover(ctx, w, h, forExport) {
  const grade = gradeById(state.gradeId);
  ctx.fillStyle = '#120a24';
  ctx.fillRect(0, 0, w, h);

  const rects = panelRects(w, h);
  rects.forEach((rect, i) => drawPanelPhoto(ctx, rect, state.panels[i] || freshPanel(), grade));

  drawGradeWash(ctx, w, h, grade, state.gradeStrength);
  drawVignette(ctx, w, h, state.gradeStrength);

  // Poster keylines around every panel.
  ctx.strokeStyle = 'rgba(10,6,24,0.9)';
  ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.004);
  rects.forEach((rect) => ctx.strokeRect(rect.x, rect.y, rect.w, rect.h));
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1;
  rects.forEach((rect) => ctx.strokeRect(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4));

  drawCaption(ctx, w, h);
  if (!forExport) drawSelection(ctx, rects);
}

/* ------------------------------------------------------------------ UI */

const preview = document.getElementById('preview');
const pctx = preview.getContext('2d');

function render() {
  const size = sizeById(state.sizeId);
  if (preview.width !== size.w || preview.height !== size.h) {
    preview.width = size.w;
    preview.height = size.h;
  }
  drawCover(pctx, size.w, size.h, false);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

async function addPhotoFromUrl(url, name) {
  if (state.photos.length >= MAX_PHOTOS) state.photos.shift();
  const img = await loadImage(url);
  state.photos.push({ img, name });
  state.activePhoto = state.photos.length - 1;
  refreshPhotoSlots();
  render();
}

function refreshPhotoSlots() {
  const wrap = document.getElementById('photo-slots');
  wrap.innerHTML = '';
  for (let i = 0; i < MAX_PHOTOS; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'slot' + (i === state.activePhoto && state.photos[i] ? ' is-active' : '');
    if (state.photos[i]) {
      const img = document.createElement('img');
      img.src = state.photos[i].img.src;
      img.alt = state.photos[i].name;
      btn.appendChild(img);
    } else {
      btn.textContent = `Photo ${i + 1}`;
    }
    btn.addEventListener('click', () => {
      if (!state.photos[i]) return;
      state.activePhoto = i;
      const panel = state.panels[state.selectedPanel];
      if (panel) panel.photo = i;
      refreshPhotoSlots();
      render();
    });
    wrap.appendChild(btn);
  }
}

function buildPicker(elId, items, activeId, onPick) {
  const wrap = document.getElementById(elId);
  wrap.innerHTML = '';
  items.forEach((item) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pick-btn' + (item.id === activeId ? ' is-active' : '');
    btn.textContent = item.label;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', item.id === activeId ? 'true' : 'false');
    btn.addEventListener('click', () => onPick(item.id));
    wrap.appendChild(btn);
  });
}

function refreshPickers() {
  buildPicker('layout-picker', LAYOUTS, state.layoutId, (id) => {
    state.layoutId = id;
    syncPanels();
    refreshPickers();
    syncPanelControls();
    render();
  });
  buildPicker('grade-picker', GRADES, state.gradeId, (id) => {
    state.gradeId = id;
    refreshPickers();
    render();
  });
  buildPicker('size-picker', POSTER_SIZES, state.sizeId, (id) => {
    state.sizeId = id;
    refreshPickers();
    render();
  });
}

function syncPanelControls() {
  const panel = state.panels[state.selectedPanel] || freshPanel();
  const zoom = document.getElementById('panel-zoom');
  zoom.value = String(Math.round(panel.zoom * 100));
  document.getElementById('panel-zoom-value').textContent = `${zoom.value}%`;
}

function selectPanel(index) {
  state.selectedPanel = index;
  syncPanelControls();
  render();
}

function exportPng() {
  const size = sizeById(state.sizeId);
  const out = document.createElement('canvas');
  out.width = size.w;
  out.height = size.h;
  drawCover(out.getContext('2d'), size.w, size.h, true);
  out.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `neon-poster-${size.w}x${size.h}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
}

/* ------------------------------------------------------------ interaction */

function canvasPoint(event) {
  const box = preview.getBoundingClientRect();
  return {
    x: (event.clientX - box.left) * (preview.width / box.width),
    y: (event.clientY - box.top) * (preview.height / box.height),
  };
}

function panelAt(point) {
  const rects = panelRects(preview.width, preview.height);
  const idx = rects.findIndex((r) => point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + r.h);
  return idx >= 0 ? idx : state.selectedPanel;
}

let drag = null;
preview.addEventListener('pointerdown', (event) => {
  const point = canvasPoint(event);
  selectPanel(panelAt(point));
  drag = { x: point.x, y: point.y };
  preview.setPointerCapture(event.pointerId);
});
preview.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const point = canvasPoint(event);
  const panel = state.panels[state.selectedPanel];
  const rect = panelRects(preview.width, preview.height)[state.selectedPanel];
  const photo = panel && panel.photo !== null ? state.photos[panel.photo] : null;
  if (!panel || !rect || !photo) { drag = { x: point.x, y: point.y }; return; }
  const box = coverBox(photo.img, rect, panel);
  if (box.slackX > 0) panel.ox -= (point.x - drag.x) / box.slackX;
  if (box.slackY > 0) panel.oy -= (point.y - drag.y) / box.slackY;
  clampPanel(panel);
  drag = { x: point.x, y: point.y };
  render();
});
preview.addEventListener('pointerup', () => { drag = null; });
preview.addEventListener('pointercancel', () => { drag = null; });
preview.addEventListener('dblclick', (event) => {
  const panel = state.panels[panelAt(canvasPoint(event))];
  if (!panel) return;
  panel.zoom = 1; panel.ox = 0; panel.oy = 0;
  syncPanelControls();
  render();
});

// Keyboard framing: arrows pan the selected panel, + / − zoom it, Tab moves to the next panel.
document.addEventListener('keydown', (event) => {
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const panel = state.panels[state.selectedPanel];
  if (!panel) return;
  const step = 0.06;
  if (event.key === 'Tab') {
    event.preventDefault();
    selectPanel((state.selectedPanel + 1) % state.panels.length);
  } else if (event.key === 'ArrowLeft') { panel.ox -= step; }
  else if (event.key === 'ArrowRight') { panel.ox += step; }
  else if (event.key === 'ArrowUp') { panel.oy -= step; }
  else if (event.key === 'ArrowDown') { panel.oy += step; }
  else if (event.key === '+' || event.key === '=') { panel.zoom *= 1.08; }
  else if (event.key === '-') { panel.zoom *= 0.92; }
  else return;
  event.preventDefault();
  clampPanel(panel);
  syncPanelControls();
  render();
});
preview.addEventListener('wheel', (event) => {
  event.preventDefault();
  const panel = state.panels[panelAt(canvasPoint(event))];
  if (!panel) return;
  panel.zoom *= event.deltaY < 0 ? 1.06 : 0.94;
  clampPanel(panel);
  syncPanelControls();
  render();
}, { passive: false });

document.getElementById('photo-input').addEventListener('change', async (event) => {
  for (const file of event.target.files) {
    await addPhotoFromUrl(URL.createObjectURL(file), file.name);
  }
  event.target.value = '';
});
document.getElementById('sample-boulevard').addEventListener('click', () => addPhotoFromUrl(SAMPLES.boulevard, 'Boulevard'));
document.getElementById('sample-pier').addEventListener('click', () => addPhotoFromUrl(SAMPLES.pier, 'Pier'));

document.getElementById('fill-all').addEventListener('click', () => {
  if (!state.photos.length) return;
  state.panels.forEach((panel) => { panel.photo = state.activePhoto; });
  render();
});
document.getElementById('cycle-photos').addEventListener('click', () => {
  if (!state.photos.length) return;
  state.panels.forEach((panel, i) => { panel.photo = i % state.photos.length; });
  render();
});

document.getElementById('panel-zoom').addEventListener('input', (event) => {
  const panel = state.panels[state.selectedPanel];
  if (!panel) return;
  panel.zoom = Number(event.target.value) / 100;
  document.getElementById('panel-zoom-value').textContent = `${event.target.value}%`;
  render();
});
document.getElementById('panel-photo-prev').addEventListener('click', () => stepPanelPhoto(-1));
document.getElementById('panel-photo-next').addEventListener('click', () => stepPanelPhoto(1));
function stepPanelPhoto(step) {
  const panel = state.panels[state.selectedPanel];
  if (!panel || !state.photos.length) return;
  const current = panel.photo === null ? 0 : panel.photo;
  panel.photo = (current + step + state.photos.length) % state.photos.length;
  render();
}
document.getElementById('panel-reset').addEventListener('click', () => {
  const panel = state.panels[state.selectedPanel];
  if (!panel) return;
  panel.zoom = 1; panel.ox = 0; panel.oy = 0;
  syncPanelControls();
  render();
});

document.getElementById('grade-strength').addEventListener('input', (event) => {
  state.gradeStrength = Number(event.target.value) / 100;
  document.getElementById('grade-strength-value').textContent = `${event.target.value}%`;
  render();
});

document.getElementById('caption-title').addEventListener('input', (event) => { state.caption.title = event.target.value; render(); });
document.getElementById('caption-subtitle').addEventListener('input', (event) => { state.caption.subtitle = event.target.value; render(); });
document.getElementById('caption-size').addEventListener('input', (event) => {
  state.caption.scale = Number(event.target.value) / 100;
  document.getElementById('caption-size-value').textContent = `${event.target.value}%`;
  render();
});
document.querySelectorAll('.pos-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.caption.pos = btn.dataset.pos;
    document.querySelectorAll('.pos-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
    render();
  });
});

document.getElementById('export-btn').addEventListener('click', exportPng);
document.getElementById('export-btn-2').addEventListener('click', exportPng);

/* ------------------------------------------------------- demo & shots */

/** Preset scene used by ?demo=1 and the screenshot modes: samples in, caption set, grade on. */
async function loadPresetScene(params) {
  const layout = params.get('layout');
  if (layout && layoutById(layout)) state.layoutId = layout;
  const size = params.get('size');
  if (size && sizeById(size)) state.sizeId = size;
  const grade = params.get('grade');
  if (grade && gradeById(grade)) state.gradeId = grade;
  const caption = params.get('caption');
  if (caption) {
    state.caption.title = caption;
    document.getElementById('caption-title').value = caption;
  }
  syncPanels();
  await addPhotoFromUrl(SAMPLES.boulevard, 'Boulevard');
  await addPhotoFromUrl(SAMPLES.pier, 'Pier');
  state.panels.forEach((panel, i) => {
    panel.photo = i % state.photos.length;
    panel.zoom = 1 + (i % 3) * 0.12;
    panel.ox = (i % 2 === 0 ? -0.12 : 0.12);
    panel.oy = (i % 3 === 0 ? 0.1 : -0.06);
  });
  refreshPickers();
  syncPanelControls();
  render();
}

async function boot() {
  syncPanels();
  refreshPickers();
  refreshPhotoSlots();
  syncPanelControls();
  render();

  const params = new URLSearchParams(location.search);
  const shot = params.get('shot');
  if (shot === 'cover' || shot === 'editor') {
    document.body.classList.add(shot === 'cover' ? 'shot-cover' : 'shot-editor');
    await loadPresetScene(params);
  } else if (params.get('demo') === '1') {
    await loadPresetScene(params);
  }
}

boot();
