// Ashima simplex noise (MIT), 3D.
const simplex = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0)) +
    i.y + vec4(0.0, i1.y, i2.y, 1.0)) +
    i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

// All motion except the cursor spring runs here, so the CPU never touches positions per frame.
export const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uAssemble;    // 0 → 1 over the intro
uniform float uScroll;      // 0 → 1 as the hero scrolls away
uniform float uScale;       // CSS px per normalized image unit
uniform vec2 uCenter;       // duck center, CSS px from canvas center
uniform float uSpread;      // scatter radius, CSS px
uniform float uSize;        // scale on aSize (aSize is CSS px)
uniform float uPixelRatio;
uniform float uDrift;       // coherent drift amplitude, CSS px
uniform float uMicro;       // per-particle micro-motion amplitude, CSS px
uniform float uExcursion;   // 0 disables edge excursions (reduced motion)

attribute vec2 aTarget;     // normalized position in the image
attribute vec3 aColor;      // palette color
attribute vec2 aScatter;    // normalized start position
attribute vec4 aRandom;     // x: intro delay, y: micro-motion phase, z: disperse distance (px), w: angle
attribute float aSize;      // diameter in CSS px
attribute float aAlpha;
attribute vec2 aNormal;     // outward normal for edge particles, zero inside
attribute vec3 aExcursion;  // x: distance px (0 = never), y: period s, z: phase
attribute vec2 aOffset;     // cursor spring offset from the CPU, CSS px

varying vec3 vColor;
varying float vAlpha;

${simplex}

void main() {
  vec2 target = aTarget * uScale + uCenter;
  vec2 start = aScatter * uSpread + uCenter;

  // Staggered assembly: each particle leaves on its own delay and eases in.
  float t = clamp((uAssemble - aRandom.x * 0.45) / 0.55, 0.0, 1.0);
  float e = 1.0 - pow(1.0 - t, 3.0);
  vec2 pos = mix(start, target, e);
  vec2 path = target - start;
  pos += vec2(-path.y, path.x) * (aRandom.w - 0.5) * 0.6 * e * (1.0 - e);

  // Idle: low-frequency noise so neighbours drift together, not static.
  float mass = mix(1.15, 0.55, smoothstep(1.5, 8.0, aSize));
  vec3 np = vec3(aTarget * 1.3, uTime * 0.045);
  vec2 idle = vec2(snoise(np), snoise(np + 31.7)) * uDrift * mass;
  float ph = aRandom.y * 6.2831853;
  idle += vec2(sin(uTime * 0.9 + ph), cos(uTime * 0.67 + ph * 1.7)) * uMicro * mass;
  // Occasional edge particles wander out along their normal, then ease back.
  if (aExcursion.x > 0.0) {
    float cyc = fract(uTime / aExcursion.y + aExcursion.z);
    float bump = sin(3.14159265 * clamp(cyc / 0.45, 0.0, 1.0));
    bump *= bump;
    vec2 tangent = vec2(-aNormal.y, aNormal.x);
    idle += (aNormal + tangent * snoise(np + 3.0) * 0.5) * aExcursion.x * bump * uExcursion;
  }
  pos += idle * e;

  // Scroll dispersal: outward from the duck's center, with a noisy swirl.
  float s = uScroll * uScroll;
  if (s > 0.0) {
    float angle = aRandom.w * 6.2831853;
    vec2 dir = normalize(aTarget + vec2(cos(angle), sin(angle)) * 0.35 + 1e-4);
    pos += dir * aRandom.z * s;
    pos += vec2(snoise(np * 0.5 + 5.0), snoise(np * 0.5 + 9.0)) * 140.0 * s;
  }

  pos += aOffset;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 0.0, 1.0);
  gl_PointSize = max(1.4, uSize * aSize * mix(1.0, 0.55, s)) * uPixelRatio;

  vColor = aColor;
  vAlpha = aAlpha * smoothstep(0.0, 0.2, t) * (1.0 - 0.85 * s);
}
`;

// Crisp, flat discs with a faint darker rim, so overlapping particles stay distinguishable up close
// without reading as outlines from a distance.
export const fragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = 1.0 - smoothstep(0.44, 0.5, d);
  if (a * vAlpha < 0.01) discard;
  vec3 color = vColor * mix(1.0, 0.95, smoothstep(0.3, 0.48, d));
  gl_FragColor = vec4(color, a * vAlpha);
}
`;

// Background dust the duck appears to assemble out of.
export const atmosphereVertexShader = /* glsl */ `
uniform float uTime;
uniform float uAssemble;
uniform float uScroll;
uniform float uScale;
uniform vec2 uCenter;
uniform vec2 uViewport;
uniform float uPixelRatio;
uniform float uDrift;

attribute vec2 aPos;        // viewport-normalized, or duck-normalized when aNearDuck = 1
attribute float aNearDuck;
attribute vec3 aRand;       // x: size px, y: alpha, z: phase

varying float vAlpha;

${simplex}

void main() {
  vec2 pos = aNearDuck > 0.5 ? aPos * uScale + uCenter : aPos * uViewport;
  vec3 np = vec3(aPos * 2.0, uTime * 0.03 + aRand.z * 10.0);
  pos += vec2(snoise(np), snoise(np + 11.0)) * uDrift * 2.5;
  vec2 away = pos - uCenter;
  pos += away / (length(away) + 1.0) * uScroll * uScroll * 90.0;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 0.0, 1.0);
  gl_PointSize = aRand.x * uPixelRatio;
  vAlpha = aRand.y * smoothstep(0.0, 0.6, uAssemble) * (1.0 - 0.6 * uScroll);
}
`;

export const atmosphereFragmentShader = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;

void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.4, 0.5, d)) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}
`;
