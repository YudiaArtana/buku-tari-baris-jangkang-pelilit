const stage = document.querySelector('#stage');
const camera = document.querySelector('#camera');
const book = document.querySelector('#book');
const previous = document.querySelector('#previous');
const next = document.querySelector('#next');
const cover = document.querySelector('#cover');
const rotate = document.querySelector('#rotate');
const reset = document.querySelector('#reset');
const zoomIn = document.querySelector('#zoom-in');
const zoomOut = document.querySelector('#zoom-out');
const position = document.querySelector('#position');
const notice = document.querySelector('#notice');
const compact = matchMedia('(pointer: coarse), (max-width: 640px)').matches;
const mesh = typeof createBookMesh === 'function' ? createBookMesh(stage, compact) : null;

const pageCount = 68;
const leafCount = (pageCount - 2) / 2;
const frontClosed = -1;
const backClosed = leafCount + 1;
const unitsPerMm = 1.36;
const paperWidth = 210 * unitsPerMm;
const paperHeight = 297 * unitsPerMm;
const boardOverhang = 2.5 * unitsPerMm;
const width = paperWidth + boardOverhang;
const height = paperHeight + 2 * boardOverhang;
const boardDepth = 2.5 * unitsPerMm;
// shortcut: caliper uses Sappi Flo 210 gsm as a reference, replace with the printer's measured stock.
const sheetDepth = .203 * unitsPerMm;
const paperDepth = leafCount * sheetDepth;
const depth = paperDepth + 2 * boardDepth;
const frontHinge = (depth - boardDepth) / 2;
const backHinge = -frontHinge;
const bindingDepth = .8 * sheetDepth;
const foldWidth = 42 * unitsPerMm;
const foldSegments = compact ? 22 : mesh ? 40 : 20;
const freeSegments = compact ? 20 : mesh ? 36 : 20;
const foldColumns = Array.from({ length: foldSegments + 1 }, (_, i) => i * foldWidth / foldSegments);
const stackColumns = [...foldColumns, paperWidth];
const turnColumns = [...foldColumns, ...Array.from({ length: freeSegments }, (_, i) =>
  foldWidth + (i + 1) * (paperWidth - foldWidth) / freeSegments)];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const views = {
  front: { pitch: -8, yaw: 27 },
  reading: { pitch: -6, yaw: 0 },
  back: { pitch: -8, yaw: -27 },
};

let step = frontClosed;
let view = { ...views.front };
let frame = spread(step);
let busy = false;
let queuedTurn = 0;
let orbit = false;
let gesture;
let dragFrame;
let viewFrame;
let zoom = 1;
let panX = 0;
let panY = 0;
let stageWidth = 0;
let stageHeight = 0;
let pinch;
const touches = new Map();
let openScale;
let closedScale;
const loaded = new Set();

function element(className, parent) {
  const node = document.createElement('div');
  node.className = className;
  parent.append(node);
  return node;
}

function face(parent, className) {
  const node = element(`face ${className}`, parent);
  node.meshMaterial = className;
  return node;
}

function place(node, x, y, z, rotation = '') {
  const transform = `translate3d(${x}px, ${y}px, ${z}px) ${rotation}`;
  if (node.meshTransform === transform) return;
  node.meshTransform = transform;
  node.style.transform = transform;
}

function size(node, w, h) {
  node.meshWidth = w;
  node.meshHeight = h;
  node.style.width = `${w}px`;
  node.style.height = `${h}px`;
}

function makeBox(parent, material, inside, frontTurn, backTurn, x, w, h) {
  const group = element('piece', parent);
  const top = face(group, material);
  const bottom = face(group, inside);
  const left = face(group, `${material} edge vertical`);
  const right = face(group, `${material} edge vertical`);
  const head = face(group, `${material} edge`);
  const tail = face(group, `${material} edge`);
  for (const [node, direction] of [[top, frontTurn], [bottom, backTurn]]) {
    size(node, w, h);
    if (direction) {
      node.classList.add('turn');
      node.dataset.turn = direction;
    }
  }

  let lastLow;
  let lastHigh;
  return {
    group, top, bottom,
    shape(low, high) {
      if (low === lastLow && high === lastHigh) return;
      lastLow = low;
      lastHigh = high;
      const thickness = high - low;
      size(left, thickness, h);
      size(right, thickness, h);
      size(head, w, thickness);
      size(tail, w, thickness);
      place(top, x, -h / 2, high);
      place(bottom, x + w, -h / 2, low, 'rotateY(180deg)');
      place(left, x, -h / 2, low, 'rotateY(-90deg)');
      place(right, x + w, -h / 2, high, 'rotateY(90deg)');
      place(head, x, -h / 2, low, 'rotateX(90deg)');
      place(tail, x, h / 2, high, 'rotateX(-90deg)');
    },
  };
}

function pageUrl(number) {
  return `assets/page-${String(number).padStart(2, '0')}.jpg`;
}

function preload(number) {
  if (!number || loaded.has(number)) return;
  loaded.add(number);
  if (mesh?.available()) {
    mesh.preload(pageUrl(number));
    return;
  }
  const image = new Image();
  image.onerror = () => {
    loaded.delete(number);
    notice.textContent = `Halaman PDF ${number} gagal dimuat. Pastikan folder assets berada di samping index.html.`;
  };
  image.src = pageUrl(number);
}

function artwork(node, number) {
  if (node.dataset.page === String(number)) return;
  node.dataset.page = number;
  node.meshArt = number ? pageUrl(number) : null;
  node.style.setProperty('--art', number ? `url("${pageUrl(number)}")` : 'none');
  preload(number);
}

const front = makeBox(book, 'board illustrated', 'board lining', 1, -1, 0, width, height);
const back = makeBox(book, 'board lining', 'board illustrated', 1, -1, 0, width, height);
front.shape(-boardDepth / 2, boardDepth / 2);
back.shape(-boardDepth / 2, boardDepth / 2);
artwork(front.top, 1);
artwork(back.bottom, pageCount);
const spineArt = 'assets/spine.webp';
const spineSpan = depth / 24;
const spinePanels = Array.from({ length: 24 }, (_, i) => {
  const outside = face(book, 'spine');
  const inside = face(book, 'board lining');
  size(outside, spineSpan + .15, height);
  size(inside, spineSpan + .15, height);
  outside.style.backgroundSize = `${depth}px 100%`;
  outside.style.backgroundPosition = `${-i * spineSpan}px 0`;
  outside.meshArt = spineArt;
  outside.meshPanel = { span: spineSpan, u0: i / 24, u1: (i + 1) / 24 };
  inside.meshPanel = { span: spineSpan };
  return { outside, inside };
});
mesh?.preload(spineArt);

let previousSpinePose;
function drawSpine(opening, closing, frontPosition, rearPosition) {
  if (previousSpinePose?.[0] === opening && previousSpinePose[1] === closing) return;
  previousSpinePose = [opening, closing];
  const exposed = opening * (1 - closing);
  const overlap = depth / 2 * exposed;
  const flex = Math.sin(Math.PI * exposed);
  const tangent = depth * (.15 + .23 * flex);
  const closedRelief = .95 * Math.max(0, 1 - exposed / .05) ** 2;
  const bulge = .65 + depth * .27 * flex - closedRelief;
  const outside = boardDepth / 2 + .18;

  function anchor(rotation, center, x, z) {
    const angle = -Math.PI * rotation;
    return [x * Math.cos(angle) + z * Math.sin(angle), center - x * Math.sin(angle) + z * Math.cos(angle)];
  }

  // Follow the outside hinges so the textured cloth cannot sink into a cover.
  const points = [
    anchor(closing, rearPosition, overlap, -outside),
    anchor(closing, rearPosition, overlap - tangent, -outside - bulge),
    anchor(opening, frontPosition, overlap - tangent, outside + bulge),
    anchor(opening, frontPosition, overlap, outside),
  ];
  let [x, z] = points[0];
  for (const [index, panel] of spinePanels.entries()) {
    const t = (index + 1) / spinePanels.length;
    const s = 1 - t;
    const weights = [s ** 3, 3 * s ** 2 * t, 3 * s * t ** 2, t ** 3];
    const nextX = points.reduce((sum, point, i) => sum + point[0] * weights[i], 0);
    const nextZ = points.reduce((sum, point, i) => sum + point[1] * weights[i], 0);
    const angle = Math.atan2(nextZ - z, nextX - x);
    const scale = Math.hypot(nextX - x, nextZ - z) / spineSpan;
    place(panel.outside, x, -height / 2, z, `rotateY(${-angle}rad) scaleX(${scale})`);
    place(panel.inside, nextX, -height / 2, nextZ, `rotateY(${Math.PI - angle}rad) scaleX(${scale})`);
    x = nextX;
    z = nextZ;
  }
}

// The sewn edge is low, then the paper rises into a shoulder and flattens.
function paperElevation(x, thickness, curve) {
  const distance = Math.min(1, x / foldWidth);
  const ramp = distance * distance * (3 - 2 * distance);
  const shoulder = 7.4 * 16 * distance ** 2 * (1 - distance) ** 2;
  return thickness + curve * ((bindingDepth - thickness) * (1 - ramp) + shoulder);
}

function paperFace(parent, start, end, reverse = false) {
  const node = face(parent, 'paper page-face');
  const inner = .3 * Math.max(0, 1 - start / foldWidth) ** 2;
  const outer = .3 * Math.max(0, 1 - end / foldWidth) ** 2;
  const textureOffset = reverse ? paperWidth - end : start;
  size(node, end - start + .24, paperHeight);
  node.style.backgroundSize = `100% 100%, ${paperWidth}px 100%`;
  node.style.backgroundPosition = `0 0, ${-textureOffset}px 0`;
  node.style.setProperty('--shade-start', reverse ? outer : inner);
  node.style.setProperty('--shade-end', reverse ? inner : outer);
  node.meshPanel = {
    span: end - start,
    u0: textureOffset / paperWidth,
    u1: (textureOffset + end - start) / paperWidth,
    shade0: reverse ? outer : inner,
    shade1: reverse ? inner : outer,
  };
  return node;
}

function placePanel(node, x, z, nextX, nextZ, span, reverse, updateCss = true) {
  const startX = reverse ? nextX : x;
  const startZ = reverse ? nextZ : z;
  const dx = (reverse ? x - nextX : nextX - x) / span;
  const dz = (reverse ? z - nextZ : nextZ - z) / span;
  const plane = node.meshPlane ??= {};
  plane.x = startX;
  plane.y = -paperHeight / 2;
  plane.z = startZ;
  plane.dx = dx;
  plane.dz = dz;
  if (updateCss) placePaperCss(node);
}

function placePaperCss(node) {
  const { x, y, z, dx, dz } = node.meshPlane;
  place(node, x, y, z,
    `rotateY(${-Math.atan2(dz, dx)}rad) scaleX(${Math.hypot(dx, dz)})`);
}

function makePaperStack(parent, side) {
  const group = element('piece', parent);
  place(group, 0, 0, side * boardDepth / 2);
  const panels = stackColumns.slice(1).map((end, i) => {
    const panel = paperFace(group, stackColumns[i], end, side === -1);
    panel.classList.add('turn');
    panel.dataset.turn = side;
    return panel;
  });
  const outer = face(group, 'paper edge vertical');
  const inner = face(group, 'paper edge vertical');
  const head = face(group, 'paper edge');
  const tail = face(group, 'paper edge');
  let lastThickness;
  let lastCurve;
  let lastPage;
  return {
    group, panels,
    draw(thickness, curve, page) {
      artwork(group, page);
      if (page !== lastPage) {
        lastPage = page;
        group.classList.toggle('endpaper', !page);
        group.meshEndpaper = !page;
      }
      if (thickness === lastThickness && curve === lastCurve) return;
      lastThickness = thickness;
      lastCurve = curve;
      group.style.setProperty('--fold-shade', curve);
      group.meshShade = curve;

      const elevations = stackColumns.map(x => paperElevation(x, thickness, curve));
      const peak = Math.max(...elevations);
      for (const [i, panel] of panels.entries()) {
        const x = stackColumns[i];
        const nextX = stackColumns[i + 1];
        placePanel(panel, x, side * elevations[i], nextX, side * elevations[i + 1],
          nextX - x, side === -1);
      }

      size(outer, thickness, paperHeight);
      size(inner, elevations[0], paperHeight);
      place(outer, paperWidth, -paperHeight / 2, side === 1 ? thickness : 0, 'rotateY(90deg)');
      place(inner, 0, -paperHeight / 2, side === 1 ? 0 : -elevations[0], 'rotateY(-90deg)');
      for (const [cap, isHead] of [[head, true], [tail, false]]) {
        const baseAtTop = isHead === (side === 1);
        const edge = baseAtTop ? 0 : 100;
        const outline = stackColumns.map((x, i) => {
          const rise = 100 * elevations[i] / peak;
          return `${100 * x / paperWidth}% ${baseAtTop ? rise : 100 - rise}%`;
        });
        size(cap, paperWidth, peak);
        cap.style.clipPath = `polygon(0 ${edge}%, ${outline.join(', ')}, 100% ${edge}%)`;
        cap.meshCap = {
          baseline: baseAtTop ? 0 : peak,
          columns: stackColumns.map((x, i) => [x, baseAtTop ? elevations[i] : peak - elevations[i]]),
        };
        place(cap, 0, isHead ? -paperHeight / 2 : paperHeight / 2,
          (baseAtTop ? 0 : peak * side), `rotateX(${isHead ? 90 : -90}deg)`);
      }
    },
  };
}

const right = makePaperStack(back.group, 1);
const left = makePaperStack(front.group, -1);
const bending = element('piece', book);
const strips = turnColumns.slice(1).map((end, i) => ({
  a: paperFace(bending, turnColumns[i], end),
  b: paperFace(bending, turnColumns[i], end, true),
  end,
  span: end - turnColumns[i],
  twist: .58 - 1.48 * ((turnColumns[i] + end) / (2 * paperWidth)) ** 1.5,
}));
let movingPage;

function spread(value) {
  return {
    front: Number(value !== frontClosed),
    back: Number(value === backClosed),
    sheets: Math.max(0, Math.min(leafCount, value)),
    leaf: 0,
    turn: 0,
  };
}

function interpolate(a, b, p) {
  return a + (b - a) * p;
}

function turnTextures(from, to) {
  const urls = [spineArt, pageUrl(1), pageUrl(pageCount)];
  for (const value of [from, to]) {
    const { sheets } = spread(value);
    if (sheets) urls.push(pageUrl(1 + 2 * sheets));
    if (sheets < leafCount) urls.push(pageUrl(2 + 2 * sheets));
  }
  return urls;
}

function pose(from, to, p) {
  const start = spread(from);
  const end = spread(to);
  const pageTurn = Math.abs(to - from) === 1 && from >= 0 && to >= 0 && from <= leafCount && to <= leafCount;
  const leaves = Math.min(start.sheets, end.sheets);
  return {
    front: interpolate(start.front, end.front, p),
    back: interpolate(start.back, end.back, p),
    sheets: pageTurn ? leaves : start.sheets,
    leaf: pageTurn ? 2 + 2 * leaves : 0,
    turn: to > from ? p : 1 - p,
  };
}

function render() {
  const { front: opening, back: closing, sheets, leaf, turn } = frame;
  const leftThickness = sheets * sheetDepth;
  const rightThickness = paperDepth - leftThickness;
  const frontPosition = interpolate(frontHinge, backHinge, opening);
  const rearPosition = interpolate(backHinge, frontPosition + paperDepth + boardDepth, closing);
  const exposed = opening * (1 - closing);
  const curve = exposed * exposed * (3 - 2 * exposed);
  place(front.group, 0, 0, frontPosition, `rotateY(${-180 * opening}deg)`);
  place(back.group, 0, 0, rearPosition, `rotateY(${-180 * closing}deg)`);
  drawSpine(opening, closing, frontPosition, rearPosition);

  left.group.hidden = opening === 0;
  left.draw(Math.max(bindingDepth, leftThickness), curve, sheets ? 1 + 2 * sheets : 0);
  const unturned = leafCount - sheets - Number(Boolean(leaf));
  right.group.hidden = closing === 1;
  right.draw(Math.max(bindingDepth, unturned * sheetDepth), curve, unturned > 0 ? 2 + 2 * (leafCount - unturned) : 0);

  bending.hidden = !leaf;
  if (leaf) {
    const angle = Math.PI * turn;
    const flex = Math.sin(angle) ** 2;
    const landThickness = Math.max(bindingDepth, leftThickness + sheetDepth);
    const thickness = interpolate(rightThickness, landThickness, turn);
    const elevationWeight = 1 - .8 * flex;
    let x = 0;
    let z = backHinge + boardDepth / 2 + bindingDepth + .06 * flex;
    let elevation = bindingDepth;
    bending.meshShade = 1 - flex;
    const newArtwork = movingPage !== leaf;
    for (const { a, b, end, span, twist } of strips) {
      const curl = angle + flex * twist;
      const nextX = x + span * Math.cos(curl);
      const nextElevation = paperElevation(end, thickness, 1);
      const nextZ = z + span * Math.sin(curl) + elevationWeight * (nextElevation - elevation);
      if (newArtwork) {
        artwork(a, leaf);
        artwork(b, leaf + 1);
      }
      placePanel(a, x, z, nextX, nextZ, span, false, false);
      placePanel(b, x, z, nextX, nextZ, span, true, false);
      x = nextX;
      z = nextZ;
      elevation = nextElevation;
    }
    movingPage = leaf;
  }

  const center = (Math.cos(Math.PI * opening) + Math.cos(Math.PI * closing)) * width / 4;
  const closed = Math.max(1 - opening, closing);
  const fit = interpolate(openScale, closedScale, closed * closed * (3 - 2 * closed));
  const cameraTransform = `translate3d(${panX}px, ${panY}px, 0) scale(${fit * zoom}) rotateX(${view.pitch}deg) rotateY(${view.yaw}deg)`;
  if (camera.meshTransform !== cameraTransform) {
    camera.meshTransform = cameraTransform;
    camera.style.transform = cameraTransform;
  }
  place(book, -center, 0, -paperDepth * closing / 2);
  if (!mesh?.paint(camera) && leaf) {
    bending.style.setProperty('--fold-shade', bending.meshShade);
    for (const { a, b } of strips) {
      placePaperCss(a);
      placePaperCss(b);
    }
  }
}

function resize() {
  stageWidth = stage.clientWidth;
  stageHeight = stage.clientHeight;
  const verticalFit = Math.max(0, stageHeight - 44) / height;
  openScale = Math.min(verticalFit, Math.max(0, stageWidth - 24) / (2 * width + 16), 1.34);
  closedScale = Math.min(verticalFit, Math.max(0, stageWidth - 42) / width, 1.34);
  mesh?.resize(stageWidth, stageHeight);
  setZoom(zoom, panX, panY);
  render();
}

function setZoom(value, x, y) {
  zoom = Math.min(3, Math.max(1, value));
  const maxX = stageWidth * (zoom - 1) / 2;
  const maxY = stageHeight * (zoom - 1) / 2;
  panX = Math.max(-maxX, Math.min(maxX, x));
  panY = Math.max(-maxY, Math.min(maxY, y));
  stage.classList.toggle('zoomed', zoom > 1);
  zoomIn.disabled = zoom >= 3;
  zoomOut.disabled = zoom <= 1;
}

function scheduleView() {
  if (viewFrame !== undefined) return;
  viewFrame = requestAnimationFrame(() => {
    viewFrame = undefined;
    render();
  });
}

function zoomBy(factor) {
  const target = Math.min(3, Math.max(1, zoom * factor));
  setZoom(target, panX * target / zoom, panY * target / zoom);
  scheduleView();
}

function viewFor(value) {
  if (value === frontClosed) return views.front;
  if (value === backClosed) return views.back;
  return views.reading;
}

function syncControls() {
  const closed = step === frontClosed || step === backClosed;
  const leftPage = 1 + step * 2;
  const rightPage = leftPage + 1;
  if (step === frontClosed) position.textContent = 'Sampul depan';
  else if (step === backClosed) position.textContent = 'Sampul belakang';
  else if (step === 0) position.textContent = 'Halaman PDF 2';
  else if (step === leafCount) position.textContent = `Halaman PDF ${leftPage}`;
  else position.textContent = `Halaman PDF ${leftPage}–${rightPage}`;
  previous.disabled = step === frontClosed;
  next.disabled = step === backClosed;
  previous.setAttribute('aria-label', step === backClosed ? 'Buka sampul belakang' : step === 0 ? 'Tutup sampul depan' : 'Halaman sebelumnya');
  next.setAttribute('aria-label', step === frontClosed ? 'Buka buku' : step === leafCount ? 'Tutup sampul belakang' : 'Halaman berikutnya');
  cover.textContent = closed ? 'Buka buku' : 'Tutup buku';
  if (step === frontClosed) preload(2);
  if (step === backClosed) preload(pageCount - 1);
  if (!closed) {
    for (let page = Math.max(2, leftPage - 2); page <= Math.min(pageCount - 1, rightPage + 2); page++) {
      preload(page);
    }
  }
}

function animate(draw, duration, movingCover) {
  if (reducedMotion.matches) return Promise.resolve();
  return new Promise(resolve => {
    let lastFrame;
    let elapsed = 0;
    function tick(now) {
      elapsed += Math.min(50, now - (lastFrame ?? now));
      lastFrame = now;
      if (elapsed >= duration) {
        resolve();
        return;
      }
      const time = elapsed / duration;
      const eased = movingCover
        ? time ** 3 * (10 - 15 * time + 6 * time ** 2)
        : (1 - Math.cos(Math.PI * time)) / 2;
      draw(eased);
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

async function move(to, progress = 0, canceled = false, chained = false) {
  if (busy || to < frontClosed || to > backClosed) return;
  busy = true;
  const from = step;
  if (mesh) mesh.hold(await mesh.prepare(turnTextures(from, to)));
  const destination = canceled ? 0 : 1;
  const startView = { ...view };
  const movingCover = from === frontClosed || from === backClosed || to === frontClosed || to === backClosed;
  const endView = movingCover ? viewFor(to) : startView;
  const yawDelta = ((endView.yaw - startView.yaw + 540) % 360) - 180;
  await animate(p => {
    frame = pose(from, to, interpolate(progress, destination, p));
    if (!canceled) {
      view.pitch = interpolate(startView.pitch, endView.pitch, p);
      view.yaw = startView.yaw + yawDelta * p;
    }
    render();
  }, (movingCover ? 960 : chained ? 420 : 550) * Math.max(.35, Math.abs(destination - progress)), movingCover);
  if (!canceled) {
    step = to;
    view = { ...endView };
  }
  frame = spread(step);
  busy = false;
  mesh?.hold(null);
  syncControls();
  render();
  const direction = queuedTurn;
  queuedTurn = 0;
  if (direction) void move(step + direction, 0, false, true);
}

function turnBy(direction) {
  if (gesture || touches.size > 1) return;
  if (busy) queuedTurn = direction;
  else void move(step + direction);
}

previous.addEventListener('click', () => turnBy(-1));
next.addEventListener('click', () => turnBy(1));
cover.addEventListener('click', () => {
  if (gesture || busy || touches.size > 1) return;
  const to = step === frontClosed ? 0 : step === backClosed ? leafCount : frontClosed;
  void move(to);
});
rotate.addEventListener('click', () => {
  orbit = !orbit;
  rotate.setAttribute('aria-pressed', String(orbit));
  stage.classList.toggle('orbit', orbit);
  syncControls();
});
reset.addEventListener('click', () => {
  if (busy || gesture || touches.size) return;
  view = { ...viewFor(step) };
  setZoom(1, 0, 0);
  render();
});
zoomIn.addEventListener('click', () => zoomBy(1.4));
zoomOut.addEventListener('click', () => zoomBy(1 / 1.4));

function orbitBy(x, y) {
  view.pitch = (view.pitch - y + 540) % 360 - 180;
  view.yaw = (view.yaw + x + 540) % 360 - 180;
  scheduleView();
}

document.addEventListener('keydown', event => {
  const key = event.key;
  if (event.altKey || event.ctrlKey || event.metaKey || gesture) return;
  if (orbit && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) {
    if (busy) return;
    const x = key === 'ArrowLeft' ? -12 : key === 'ArrowRight' ? 12 : 0;
    const y = key === 'ArrowUp' ? -12 : key === 'ArrowDown' ? 12 : 0;
    orbitBy(x, y);
  } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
    turnBy(key === 'ArrowLeft' ? -1 : 1);
  } else {
    return;
  }
  event.preventDefault();
});

stage.addEventListener('pointerdown', event => {
  if (busy || event.button !== 0) return;
  if (event.pointerType === 'touch') {
    if (touches.size === 2) return;
    touches.set(event.pointerId, [event.clientX, event.clientY]);
    stage.setPointerCapture(event.pointerId);
    if (touches.size === 2) {
      if (dragFrame !== undefined) cancelAnimationFrame(dragFrame);
      dragFrame = undefined;
      gesture = undefined;
      frame = spread(step);
      const { x, y, distance } = touchGeometry();
      const bounds = stage.getBoundingClientRect();
      pinch = { x, y, distance: Math.max(1, distance), zoom, panX, panY,
        centerX: bounds.left + stageWidth / 2, centerY: bounds.top + stageHeight / 2 };
      scheduleView();
      return;
    }
  }
  if (!event.isPrimary || gesture) return;
  const panning = !orbit && zoom > 1;
  const direction = orbit || panning ? 0 : Number(event.target.dataset.turn || 0);
  const valid = step + direction >= frontClosed && step + direction <= backClosed;
  const pages = valid && direction && mesh ? turnTextures(step, step + direction) : null;
  gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, direction: valid ? direction : 0, panning, progress: 0, displayed: 0, dragged: false, pages };
  stage.setPointerCapture(event.pointerId);
  stage.classList.add('dragging');
});

function touchGeometry() {
  const [[ax, ay], [bx, by]] = touches.values();
  return { x: (ax + bx) / 2, y: (ay + by) / 2, distance: Math.hypot(ax - bx, ay - by) };
}

stage.addEventListener('pointermove', event => {
  if (touches.has(event.pointerId)) {
    touches.set(event.pointerId, [event.clientX, event.clientY]);
    if (pinch) {
      const { x, y, distance } = touchGeometry();
      const target = Math.min(3, Math.max(1, pinch.zoom * distance / pinch.distance));
      const ratio = target / pinch.zoom;
      setZoom(target, x - pinch.centerX - (pinch.x - pinch.centerX - pinch.panX) * ratio,
        y - pinch.centerY - (pinch.y - pinch.centerY - pinch.panY) * ratio);
      scheduleView();
      return;
    }
  }
  if (gesture?.id !== event.pointerId) return;
  const dx = event.clientX - gesture.x;
  const dy = event.clientY - gesture.y;
  if (!gesture.dragged && Math.hypot(dx, dy) < 6) return;
  gesture.dragged = true;
  if (gesture.direction) {
    const distance = Math.max(64, Math.min(stage.clientWidth * .35, 220));
    gesture.progress = Math.max(0, Math.min(.98, -dx * gesture.direction / distance));
    if (gesture.pages && !mesh.ready(gesture.pages)) return;
    if (dragFrame !== undefined) return;
    dragFrame = requestAnimationFrame(() => {
      dragFrame = undefined;
      gesture.displayed = gesture.progress;
      frame = pose(step, step + gesture.direction, gesture.displayed);
      render();
    });
  } else {
    if (gesture.panning) {
      setZoom(zoom, panX + dx, panY + dy);
      scheduleView();
    } else {
      orbitBy(dx * .52, dy * .52);
    }
    gesture.x = event.clientX;
    gesture.y = event.clientY;
  }
});

function finishGesture(event) {
  if (touches.delete(event.pointerId) && pinch) {
    pinch = undefined;
    stage.classList.remove('dragging');
    return;
  }
  if (gesture?.id !== event.pointerId) return;
  const { direction, progress, displayed, dragged } = gesture;
  if (dragFrame !== undefined) {
    cancelAnimationFrame(dragFrame);
    dragFrame = undefined;
  }
  gesture = undefined;
  stage.classList.remove('dragging');
  if (direction && (dragged || event.type === 'pointerup')) {
    const canceled = event.type !== 'pointerup' || (dragged && progress < .22);
    void move(step + direction, displayed, canceled);
  }
}
stage.addEventListener('pointerup', finishGesture);
stage.addEventListener('pointercancel', finishGesture);
stage.addEventListener('lostpointercapture', finishGesture);
stage.addEventListener('webglcontextlost', () => requestAnimationFrame(render), true);

new ResizeObserver(resize).observe(stage);
syncControls();
resize();
