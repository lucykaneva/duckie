type RGB = [number, number, number];

interface PixelInfo {
  h: number;
  s: number;
  lum: number;
}

export interface ParticleSample {
  targets: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  alphas: Float32Array;
  normals: Float32Array;
  excursions: Float32Array;
  count: number;
}

/** Duck scale (CSS px per normalized unit) at which particle diameters are authored. */
export const REFERENCE_SCALE = 520;

export async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return img;
}

const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
const PALETTE = {
  primary: hex('#F7C843'),
  light: hex('#FFD95A'),
  dark: hex('#EAAF2E'),
  deep: hex('#E3A22B'),
  beak: hex('#F58B3A'),
  burnt: hex('#C95E2D'),
  beakShadow: hex('#DE6827'),
  eye: hex('#292824'),
  glint: hex('#FFFFFF'),
};

const BODY = 1, WING = 2, HIGHLIGHT = 3, BEAK = 4, EYE = 5, GLINT = 6, MOUTH = 7, OUTLINE = 8;

/**
 * Body particles are placed largest first so smaller ones settle into the gaps.
 * d is the diameter in CSS px at REFERENCE_SCALE; minInside is the minimum distance
 * inside the silhouette (sample px, negative = outside) where the band may appear.
 */
const BANDS = [
  { share: 0.05, d: [7.5, 9], minInside: 20 },
  { share: 0.3, d: [5.5, 7], minInside: 11 },
  { share: 0.55, d: [3.5, 5], minInside: -8 },
  { share: 0.1, d: [1.5, 2.5], minInside: -Infinity },
] as const;
const TINY = BANDS.length - 1;
const MEDIUM = 2;

/** Total disc area relative to the duck's area; overlap brings perceived coverage to ~85%. */
const COVERAGE = 1.6;
/** Extra medium particles in the core, as a share of the base count. */
const CORE_FILL = 0.12;
/** Tiny particles are mostly kept for the edge, so their count is cut and the core rejects them. */
const TINY_SCALE = 0.6;
// Distances in sample px (≈1.24 CSS px each at the reference scale).
const CORE = 12;
const SCATTER = 18;
/** Eye size relative to the illustration, with a little angular wobble so its edge isn't a perfect circle. */
const EYE_SCALE = 0.82;
const EYE_WOBBLE = 0.02;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rand = (a: number, b: number) => lerp(a, b, Math.random());
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const jitter = (c: RGB, amount: number): RGB => {
  const v = 1 + (Math.random() - 0.5) * amount;
  return c.map((ch) => Math.min(1, ch * v)) as RGB;
};

function rgbInfo(r: number, g: number, b: number): PixelInfo {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s, lum: 0.2126 * r + 0.7152 * g + 0.0722 * b };
}

/** Smooth 2D value noise in 0..1. */
function makeNoise() {
  const seed = (Math.random() * 2 ** 31) | 0;
  const hash = (ix: number, iy: number) => {
    let n = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + seed) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  return (x: number, y: number) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return lerp(lerp(hash(ix, iy), hash(ix + 1, iy), sx), lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), sx), sy);
  };
}

/** Two-pass chamfer distance from seed pixels (non-zero = label), filling only `open` pixels. */
function chamfer(w: number, h: number, seeds: Uint8Array, open: Uint8Array) {
  const n = w * h;
  const dist = new Float32Array(n).fill(Infinity);
  const label = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (seeds[p]) { dist[p] = 0; label[p] = seeds[p]; }
  const relax = (p: number, q: number, c: number) => {
    const v = dist[q] + c;
    if (v < dist[p]) { dist[p] = v; label[p] = label[q]; }
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!open[p]) continue;
      if (x > 0) relax(p, p - 1, 1);
      if (y > 0) {
        relax(p, p - w, 1);
        if (x > 0) relax(p, p - w - 1, Math.SQRT2);
        if (x < w - 1) relax(p, p - w + 1, Math.SQRT2);
      }
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x;
      if (!open[p]) continue;
      if (x < w - 1) relax(p, p + 1, 1);
      if (y < h - 1) {
        relax(p, p + w, 1);
        if (x < w - 1) relax(p, p + w + 1, Math.SQRT2);
        if (x > 0) relax(p, p + w - 1, Math.SQRT2);
      }
    }
  }
  return { dist, label };
}

function boxFraction(src: Uint8Array, w: number, h: number) {
  const integral = new Uint32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
    }
  }
  return (x: number, y: number, r: number) => {
    const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r);
    const x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1);
    const sum = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
    return sum / ((x1 - x0) * (y1 - y0));
  };
}

/**
 * Builds a dense, clustered cloud of overlapping particles shaped like the image.
 * Targets are normalized so the image's longest side spans -0.5..0.5, y up.
 * Transparent PNGs use alpha; fully opaque images key out the corner color instead.
 */
export function samplePixels(
  img: HTMLImageElement,
  { resolution = 420, alphaThreshold = 110, keyTolerance = 42 } = {},
): ParticleSample {
  const scale = resolution / Math.max(img.naturalWidth, img.naturalHeight);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const n = w * h;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < alphaThreshold) transparent++;
  const useAlpha = transparent / n > 0.01;
  const key = [data[0], data[1], data[2]];
  const visibleAt = (p: number) => {
    const i = p * 4;
    if (useAlpha) return data[i + 3] >= alphaThreshold;
    const dr = data[i] - key[0];
    const dg = data[i + 1] - key[1];
    const db = data[i + 2] - key[2];
    return dr * dr + dg * dg + db * db > keyTolerance * keyTolerance;
  };

  const info: (PixelInfo | undefined)[] = new Array(n);
  const mask = new Uint8Array(n);
  const notMask = new Uint8Array(n);
  const dark = new Uint8Array(n);
  const wingish = new Uint8Array(n);
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let p = 0; p < n; p++) {
    if (!visibleAt(p)) { notMask[p] = 1; continue; }
    const x = p % w, y = (p / w) | 0;
    const c = rgbInfo(data[p * 4] / 255, data[p * 4 + 1] / 255, data[p * 4 + 2] / 255);
    info[p] = c;
    mask[p] = 1;
    dark[p] = c.lum < 0.32 || (c.s < 0.25 && c.lum < 0.55) ? 1 : 0;
    wingish[p] = !dark[p] && c.lum >= 0.55 && c.lum < 0.745 && c.h >= 34 && c.h < 50 && c.s > 0.55 ? 1 : 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const bw = Math.max(1, maxX - minX + 1);
  const bh = Math.max(1, maxY - minY + 1);
  const darkFraction = boxFraction(dark, w, h);
  const wingFraction = boxFraction(wingish, w, h);
  const rDark = Math.max(3, Math.round(resolution * 0.02));

  const beakColored = (q: number) => {
    const c = info[q];
    return !!c && !dark[q] && c.h >= 5 && c.h < 36 && c.s > 0.45;
  };
  const beakNear = (x: number, y: number, dir: number) => {
    for (let s = 1; s <= 6; s++) {
      const yy = y + dir * s;
      if (yy < 0 || yy >= h) return false;
      if (beakColored(yy * w + x)) return true;
    }
    return false;
  };

  // Feature labels. Dark strokes become OUTLINE and are later absorbed by whatever they border.
  const raw = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (!mask[p]) continue;
    const c = info[p]!;
    const x = p % w, y = (p / w) | 0;
    const rx = (x - minX) / bw, ry = (y - minY) / bh;
    if (dark[p]) {
      if (darkFraction(x, y, rDark) > 0.5 && rx > 0.21 && rx < 0.37 && ry > 0.08 && ry < 0.3) raw[p] = EYE;
      else if (beakNear(x, y, -1) && beakNear(x, y, 1)) raw[p] = MOUTH;
      else raw[p] = OUTLINE;
    } else if (c.lum > 0.86 && c.s < 0.5) raw[p] = darkFraction(x, y, rDark) > 0.3 ? GLINT : HIGHLIGHT;
    else if (beakColored(p)) raw[p] = BEAK;
    else raw[p] = wingFraction(x, y, 4) > 0.55 ? WING : BODY;
  }

  const outlineSeeds = new Uint8Array(n);
  const outlineOpen = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (raw[p] === OUTLINE) outlineOpen[p] = 1;
    else if (raw[p] && raw[p] !== MOUTH) outlineSeeds[p] = raw[p];
  }
  const absorbed = chamfer(w, h, outlineSeeds, outlineOpen).label;
  const label = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (mask[p]) label[p] = raw[p] === OUTLINE ? absorbed[p] || BODY : raw[p];

  // The wing is refit as an oval from its pixel moments, so it reads as one contained shape.
  let wn = 0, wmx = 0, wmy = 0;
  for (let p = 0; p < n; p++) if (label[p] === WING) { wn++; wmx += p % w; wmy += (p / w) | 0; }
  if (wn > 50) {
    wmx /= wn;
    wmy /= wn;
    let sxx = 0, syy = 0, sxy = 0;
    for (let p = 0; p < n; p++) {
      if (label[p] !== WING) continue;
      const dx = (p % w) - wmx, dy = ((p / w) | 0) - wmy;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    sxx /= wn; syy /= wn; sxy /= wn;
    const det = sxx * syy - sxy * sxy;
    const wingNoise = makeNoise();
    for (let p = 0; p < n; p++) {
      if (label[p] !== WING && label[p] !== BODY) continue;
      const x = p % w, y = (p / w) | 0;
      const dx = x - wmx, dy = y - wmy;
      // Mahalanobis radius; a uniform ellipse ends at 2 standard deviations.
      const m = Math.sqrt((syy * dx * dx - 2 * sxy * dx * dy + sxx * dy * dy) / det) / 2;
      label[p] = m < 0.97 * (1 + (wingNoise(x / 14, y / 14) - 0.5) * 0.08) ? WING : BODY;
    }
  }

  // The eye is a smooth ellipse fit to the illustration's (jagged) eye pixels, drawn smaller;
  // the freed ring becomes body.
  const eyePixels: number[] = [], glintPixels: number[] = [];
  let ecx = 0, ecy = 0;
  for (let p = 0; p < n; p++) {
    if (label[p] === EYE) eyePixels.push(p);
    else if (label[p] === GLINT) glintPixels.push(p);
    else continue;
    ecx += p % w;
    ecy += (p / w) | 0;
  }
  const eyeN = eyePixels.length + glintPixels.length;
  ecx = eyeN ? ecx / eyeN : 0;
  ecy = eyeN ? ecy / eyeN : 0;
  let exx = 0, eyy = 0, exy = 0;
  for (const p of [...eyePixels, ...glintPixels]) {
    const dx = (p % w) - ecx, dy = ((p / w) | 0) - ecy;
    exx += dx * dx; eyy += dy * dy; exy += dx * dy;
  }
  exx = exx / (eyeN || 1) + 0.5; eyy = eyy / (eyeN || 1) + 0.5; exy /= eyeN || 1;
  const eDet = exx * eyy - exy * exy;
  const eyeR = 2.3 * Math.sqrt(Math.max(exx, eyy));
  /** 0 at the eye's centre, 1 on the fitted ellipse. */
  const eyeM = (x: number, y: number) => {
    const dx = x - ecx, dy = y - ecy;
    return Math.sqrt((eyy * dx * dx - 2 * exy * dx * dy + exx * dy * dy) / eDet) / 2;
  };
  for (const p of [...eyePixels, ...glintPixels]) {
    if (eyeM(p % w, (p / w) | 0) >= EYE_SCALE - EYE_WOBBLE) label[p] = BODY;
  }

  const inside = chamfer(w, h, notMask, mask).dist;
  const outsideSeeds = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const l = label[p];
    if (l) outsideSeeds[p] = l === MOUTH ? BEAK : l === EYE || l === GLINT ? BODY : l;
  }
  const outside = chamfer(w, h, outsideSeeds, notMask);
  const all = new Uint8Array(n).fill(1);
  const featureSeeds = new Uint8Array(n);
  const beakSeeds = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (label[p] === EYE || label[p] === GLINT || label[p] === MOUTH) featureSeeds[p] = 1;
    if (label[p] === BEAK) beakSeeds[p] = 1;
  }
  const featureDist = chamfer(w, h, featureSeeds, all).dist;
  const beakDist = chamfer(w, h, beakSeeds, all).dist;

  // Distance to the wing boundary from either side, for a faint lower-density seam around it.
  const wingSeeds = new Uint8Array(n);
  const nonWingSeeds = new Uint8Array(n);
  const wingOpen = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (label[p] === WING) { wingSeeds[p] = 1; wingOpen[p] = 1; }
    else if (mask[p]) nonWingSeeds[p] = 1;
  }
  const wingOut = chamfer(w, h, wingSeeds, all).dist;
  const wingIn = chamfer(w, h, nonWingSeeds, wingOpen).dist;

  const sd = new Float32Array(n);
  for (let p = 0; p < n; p++) sd[p] = mask[p] ? inside[p] : -outside.dist[p];
  const labelAt = (p: number) => (mask[p] ? label[p] : outside.label[p]);
  const isFeature = (l: number) => l === EYE || l === GLINT || l === MOUTH;

  // Outward normal (image coordinates) from the signed-distance gradient.
  const normalAt = (p: number): [number, number] => {
    const x = p % w, y = (p / w) | 0;
    const gx = sd[y * w + Math.min(w - 1, x + 1)] - sd[y * w + Math.max(0, x - 1)];
    const gy = sd[Math.min(h - 1, y + 1) * w + x] - sd[Math.max(0, y - 1) * w + x];
    const len = Math.hypot(gx, gy) || 1;
    return [-gx / len, -gy / len];
  };

  let mouthY = 0, mouthN = 0;
  for (let p = 0; p < n; p++) if (label[p] === MOUTH) { mouthY += (p / w) | 0; mouthN++; }
  mouthY = mouthN ? mouthY / mouthN : minY + bh * 0.35;

  const pick = (light: number, darkShare: number): RGB => {
    const r = Math.random();
    return jitter(r < light ? PALETTE.light : r < light + darkShare ? PALETTE.dark : PALETTE.primary, 0.04);
  };
  const colorFor = (l: number, p: number, y: number): RGB => {
    if (l === BEAK) return jitter(y > mouthY ? PALETTE.beakShadow : PALETTE.beak, 0.05);
    if (l === WING) {
      const t = rand(0.45, 0.75) * lerp(0.6, 1, smoothstep(0, 5, wingIn[p]));
      return jitter(PALETTE.primary.map((ch, i) => lerp(ch, PALETTE.dark[i], t)) as RGB, 0.03);
    }
    if (l === HIGHLIGHT) return pick(0.55, 0);
    // No darker specks right around the wing, so its edge stays clean.
    return pick(0.09, wingOut[p] < 10 ? 0 : 0.05);
  };

  const zone: number[] = [];
  let bodyArea = 0;
  for (let p = 0; p < n; p++) {
    if (mask[p]) {
      if (isFeature(label[p])) continue;
      zone.push(p);
      bodyArea++;
    } else if (outside.dist[p] <= SCATTER) zone.push(p);
  }

  const PX = REFERENCE_SCALE / Math.max(w, h);
  const avgArea = BANDS.reduce((s, b) => s + b.share * (Math.PI / 4) * ((b.d[0] + b.d[1]) / 2) ** 2, 0);
  const total = Math.round((bodyArea * PX * PX * COVERAGE) / avgArea);

  const clusterNoise = makeNoise();
  const edgeNoise = makeNoise();
  const bellyNoise = makeNoise();
  const cluster = (x: number, y: number) =>
    clamp01((clusterNoise(x / 30, y / 30) * 0.7 + clusterNoise(x / 12 + 7.3, y / 12 + 1.1) * 0.3 - 0.5) * 1.8 + 0.5);
  const wobble = (x: number, y: number) => (edgeNoise(x / 38, y / 38) - 0.5) * 10 + (edgeNoise(x / 11 + 3.1, y / 11 + 8.7) - 0.5) * 4;

  /**
   * How much the edge dissolves here, 0..1: the face and front of the chest stay defined,
   * the top of the head, back and tail dissolve most, the lower belly in patches.
   */
  const dissolveAt = (nrm: [number, number], x: number, y: number, rx: number) => {
    const up = smoothstep(0.2, 0.8, -nrm[1]);
    const down = smoothstep(0.2, 0.8, nrm[1]);
    const front = rx < 0.45 ? smoothstep(0.3, 0.8, -nrm[0]) : 0;
    const tail = smoothstep(0.75, 0.95, rx);
    const belly = down * smoothstep(0.35, 0.7, bellyNoise(x / 45, y / 45));
    return clamp01(0.3 + 0.5 * up * (1 - 0.5 * tail) + 0.1 * tail + 0.55 * belly - 0.45 * front);
  };
  const edgeKeep = (s: number, dis: number) => {
    const inner = lerp(4, 12, dis), outer = lerp(4, 10, dis);
    const atEdge = lerp(0.85, 0.5, dis);
    if (s >= inner) return 1;
    if (s >= 0) return lerp(atEdge, 1, s / inner);
    if (s >= -outer) return lerp(0.08, atEdge, (s + outer) / outer);
    if (s >= -SCATTER) return lerp(0.004, 0.06, dis);
    return 0;
  };
  const clusterKeep = (band: number, c: number) => {
    if (band < MEDIUM) return 0.2 + 0.8 * smoothstep(0.3, 0.7, c);
    if (band === MEDIUM) return 0.55 + 0.45 * c;
    return 0.6 + 0.4 * (1 - c);
  };

  const X: number[] = [], Y: number[] = [], R: number[] = [];
  const out = { colors: [] as number[], sizes: [] as number[], alphas: [] as number[], normals: [] as number[], excursions: [] as number[] };
  const add = (x: number, y: number, dpx: number, color: RGB, alpha: number, nrm: [number, number], exc: number[]) => {
    X.push(x);
    Y.push(y);
    R.push(dpx / PX / 2);
    out.colors.push(...color);
    out.sizes.push(dpx);
    out.alphas.push(alpha);
    out.normals.push(nrm[0], -nrm[1]);
    out.excursions.push(...exc);
  };
  const noExcursion = [0, 1, 0];

  // Grid cells wider than the largest diameter, so a 3x3 neighbourhood covers every conflict.
  const cell = BANDS[0].d[1] / PX + 0.5;
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
  const grid: number[][] = Array.from({ length: gw * gh }, () => []);
  const gx = (x: number) => Math.min(gw - 2, Math.max(1, Math.floor(x / cell) + 1));
  const gy = (y: number) => Math.min(gh - 2, Math.max(1, Math.floor(y / cell) + 1));
  const fits = (x: number, y: number, r: number, f: number) => {
    const cx = gx(x), cy = gy(y);
    for (let j = cy - 1; j <= cy + 1; j++) {
      for (let i = cx - 1; i <= cx + 1; i++) {
        for (const k of grid[j * gw + i]) {
          const dx = X[k] - x, dy = Y[k] - y, m = f * (r + R[k]);
          if (dx * dx + dy * dy < m * m) return false;
        }
      }
    }
    return true;
  };

  /** Places up to `target` particles of band b; `coreOnly` restricts them to broad interior areas. */
  const place = (b: number, target: number, coreOnly: boolean) => {
    const band = BANDS[b];
    let placed = 0;
    for (let a = 0; a < target * 40 && placed < target && zone.length; a++) {
      const p = zone[(Math.random() * zone.length) | 0];
      const s = sd[p];
      if (s < band.minInside || (coreOnly && s < CORE)) continue;
      let x = (p % w) + Math.random();
      let y = ((p / w) | 0) + Math.random();
      const l = labelAt(p);
      const rx = (x - minX) / bw, ry = (y - minY) / bh;
      const detail = l === BEAK || featureDist[p] < 9 || beakDist[p] < 7 || (rx > 0.92 && ry < 0.45);
      if ((band.minInside > 0 || coreOnly) && detail) continue;
      const core = s >= CORE && !detail;
      const nrm = normalAt(p);
      const dis = dissolveAt(nrm, x, y, rx);
      const inWing = l === WING && wingIn[p] > 3;
      // The wing gets even, slightly denser packing instead of the body's clustering.
      const c = inWing ? lerp(cluster(x, y), 0.65, 0.7) : cluster(x, y);
      const sn = s + wobble(x, y) * lerp(0.5, 1.3, dis);
      let keep = edgeKeep(sn, dis) * clusterKeep(b, c);
      if (b === TINY && core) keep *= 0.15;
      if (Math.random() > keep) continue;

      const [lo, hi] = b === MEDIUM && (detail || s < 6) ? [3, 3.9] : band.d;
      const dpx = rand(lo, hi) * rand(0.88, 1.12);
      if (s > -10 && s < 12) {
        const j = rand(-3, 3) * lerp(0.5, 1.3, dis);
        x += nrm[0] * j;
        y += nrm[1] * j;
      }
      const f = b === TINY ? 0.82 : core ? lerp(0.8, 0.55, c) - (inWing ? 0.03 : 0) : lerp(0.86, 0.6, c);
      if (!fits(x, y, dpx / PX / 2, f)) continue;

      const base = sn >= 6 ? rand(0.93, 1) : sn >= 0 ? rand(0.85, 1) : sn >= -6 ? rand(0.6, 0.9) : rand(0.3, 0.55);
      const alpha = Math.min(1, base * rand(0.9, 1.08));
      const exc = s < 4 && s > -6 && Math.random() < 0.035 ? [rand(6, 16), rand(12, 24), Math.random()] : noExcursion;
      grid[gy(y) * gw + gx(x)].push(X.length);
      add(x, y, dpx, colorFor(l, p, y), alpha, nrm, exc);
      placed++;
    }
    return placed;
  };

  let carry = 0;
  BANDS.forEach((band, b) => {
    const share = b === TINY ? band.share * TINY_SCALE : band.share;
    const target = Math.round(total * share) + carry;
    const placed = place(b, target, false);
    carry = b < TINY ? target - placed : 0;
    if (b === MEDIUM) place(MEDIUM, Math.round(total * CORE_FILL), true);
  });

  // Facial details drawn last, on top of the body.
  const discArea = (d: [number, number]) => (Math.PI / 4) * ((d[0] + d[1]) / 2) ** 2;
  const feature = (pixels: number[], d: [number, number], coverage: number, alpha: [number, number], color: () => RGB, k = 1) => {
    const count = Math.round((pixels.length * k * k * PX * PX * coverage) / discArea(d));
    for (let i = 0; i < count; i++) {
      const p = pixels[(Math.random() * pixels.length) | 0];
      const x = ecx + ((p % w) + Math.random() - ecx) * k;
      const y = ecy + (((p / w) | 0) + Math.random() - ecy) * k;
      add(x, y, rand(...d), color(), rand(...alpha), [0, 0], noExcursion);
    }
  };
  const mouthPixels: number[] = [];
  for (let p = 0; p < n; p++) if (label[p] === MOUTH) mouthPixels.push(p);
  feature(mouthPixels, [1.8, 2.8], 0.9, [0.65, 0.88], () => jitter(Math.random() < 0.8 ? PALETTE.burnt : PALETTE.beakShadow, 0.05));

  if (eyeN) {
    const eyeNoise = makeNoise();
    const d: [number, number] = [2.2, 3.2];
    const count = Math.round((Math.PI * Math.sqrt(eDet) * 4 * EYE_SCALE ** 2 * PX * PX * 2.6) / discArea(d));
    for (let placed = 0, a = 0; placed < count && a < count * 4; a++) {
      const x = ecx + rand(-1, 1) * eyeR, y = ecy + rand(-1, 1) * eyeR;
      const ang = Math.atan2(y - ecy, x - ecx);
      const edge = EYE_SCALE + (eyeNoise(Math.cos(ang) * 1.6 + 5, Math.sin(ang) * 1.6 + 5) - 0.5) * 2 * EYE_WOBBLE;
      const m = eyeM(x, y) / edge;
      if (m >= 1) continue;
      // A softer rim instead of a hard-edged disc.
      const rim = m > 0.85;
      if (rim && Math.random() < 0.15) continue;
      add(x, y, rand(...d) * (rim ? 0.9 : 1), jitter(PALETTE.eye, 0.06), rim ? rand(0.8, 0.95) : rand(0.95, 1), [0, 0], noExcursion);
      placed++;
    }
  }
  feature(glintPixels, [2, 3], 2.6, [0.95, 1], () => PALETTE.glint, EYE_SCALE);

  const norm = 1 / Math.max(w, h);
  const targets = new Float32Array(X.length * 2);
  for (let i = 0; i < X.length; i++) {
    targets[i * 2] = (X[i] - w / 2) * norm;
    targets[i * 2 + 1] = (h / 2 - Y[i]) * norm;
  }

  return {
    targets,
    colors: new Float32Array(out.colors),
    sizes: new Float32Array(out.sizes),
    alphas: new Float32Array(out.alphas),
    normals: new Float32Array(out.normals),
    excursions: new Float32Array(out.excursions),
    count: X.length,
  };
}
