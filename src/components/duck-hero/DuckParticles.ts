import * as THREE from 'three';
import { loadImage, samplePixels, REFERENCE_SCALE, type ParticleSample } from './sampleImage';
import { vertexShader, fragmentShader, atmosphereVertexShader, atmosphereFragmentShader } from './shaders';

const INTRO_MS = 2800;
const REPEL = { radius: 110, strength: 2.4, stiffness: 0.07, damping: 0.82 };
// sRGB, passed straight to the shader (THREE.Color would convert it to linear).
const DUST_COLOR: [number, number, number] = [0x8f / 255, 0x89 / 255, 0x7e / 255];

interface Options {
  /** Element the canvas fills (the sticky hero viewport). */
  container: HTMLElement;
  /** Tall element whose scroll drives dispersal. */
  scrollTrack: HTMLElement;
  /** Image url. */
  src: string;
}

export class DuckParticles {
  private container: HTMLElement;
  private scrollTrack: HTMLElement;
  private src: string;
  private reducedMotion: boolean;
  private disposed = false;

  private pointer = { x: 0, y: 0, active: false };
  private scroll = 0;
  private scrollTarget = 0;
  private springAsleep = true;
  private running = false;
  private visible = true;
  private raf = 0;
  private startTime = 0;
  private lastTime = 0;

  private count = 0;
  private dustCount = 0;
  private targets!: Float32Array;
  private offset!: Float32Array;
  private velocity!: Float32Array;
  private scale = 1;
  private center = { x: 0, y: 0 };

  private renderer?: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  private geometry!: THREE.BufferGeometry;
  private material!: THREE.ShaderMaterial;
  private offsetAttr!: THREE.BufferAttribute;
  private dustGeometry!: THREE.BufferGeometry;
  private dustMaterial!: THREE.ShaderMaterial;
  private dust!: THREE.Points;

  private resizeObserver?: ResizeObserver;
  private intersection?: IntersectionObserver;
  private onPointerMove = (e: PointerEvent) => {
    const rect = this.container.getBoundingClientRect();
    this.pointer.x = e.clientX - rect.left - rect.width / 2;
    this.pointer.y = rect.height / 2 - (e.clientY - rect.top);
    this.pointer.active = e.clientY >= rect.top && e.clientY <= rect.bottom;
    this.springAsleep = false;
  };
  private onPointerLeave = () => {
    this.pointer.active = false;
  };
  private onScroll = () => {
    const rect = this.scrollTrack.getBoundingClientRect();
    const travel = Math.max(1, rect.height - innerHeight);
    this.scrollTarget = Math.min(1, Math.max(0, -rect.top / travel));
  };

  constructor({ container, scrollTrack, src }: Options) {
    this.container = container;
    this.scrollTrack = scrollTrack;
    this.src = src;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  async init() {
    const img = await loadImage(this.src);
    // React may unmount before the image finishes loading.
    if (this.disposed) return;

    const sample = samplePixels(img);
    this.dustCount = innerWidth < 768 ? 24 : 40;
    this.count = sample.count;
    this.targets = sample.targets;

    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    this.camera.position.z = 1;

    this.buildGeometry(sample);
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uAssemble: { value: this.reducedMotion ? 1 : 0 },
        uScroll: { value: 0 },
        uScale: { value: 1 },
        uCenter: { value: new THREE.Vector2() },
        uSpread: { value: 1 },
        uSize: { value: 1 },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
        uDrift: { value: this.reducedMotion ? 0.8 : 2.4 },
        uMicro: { value: this.reducedMotion ? 0 : 0.7 },
        uExcursion: { value: this.reducedMotion ? 0 : 1 },
      },
    });

    const points = new THREE.Points(this.geometry, this.material);
    points.frustumCulled = false;
    this.buildAtmosphere();
    this.scene.add(this.dust, points);

    this.bindEvents();
    this.resize();
    this.startTime = performance.now();
    this.lastTime = this.startTime;
    this.start();
  }

  private buildGeometry({ targets, colors, sizes, alphas, normals, excursions, count }: ParticleSample) {
    const scatter = new Float32Array(count * 2);
    const random = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      // Start on a wide ring-ish cloud around the duck.
      const a = Math.random() * Math.PI * 2;
      const r = 0.35 + Math.pow(Math.random(), 0.6) * 0.75;
      scatter[i * 2] = Math.cos(a) * r;
      scatter[i * 2 + 1] = Math.sin(a) * r;
      random[i * 4] = Math.random();
      random[i * 4 + 1] = Math.random();
      random[i * 4 + 2] = 260 + Math.random() * 720;
      random[i * 4 + 3] = Math.random();
    }

    this.offset = new Float32Array(count * 2);
    this.velocity = new Float32Array(count * 2);

    const g = new THREE.BufferGeometry();
    // The vertex shader computes the real position; this attribute only satisfies three.js.
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aTarget', new THREE.BufferAttribute(targets, 2));
    g.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('aScatter', new THREE.BufferAttribute(scatter, 2));
    g.setAttribute('aRandom', new THREE.BufferAttribute(random, 4));
    g.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    g.setAttribute('aNormal', new THREE.BufferAttribute(normals, 2));
    g.setAttribute('aExcursion', new THREE.BufferAttribute(excursions, 3));
    this.offsetAttr = new THREE.BufferAttribute(this.offset, 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aOffset', this.offsetAttr);
    this.geometry = g;
  }

  /** Sparse warm-gray dust across the hero, denser near the duck so there's no hard edge. */
  private buildAtmosphere() {
    const n = this.dustCount;
    const pos = new Float32Array(n * 2);
    const near = new Float32Array(n);
    const rnd = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      if (i < n * 0.2) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.36 + Math.random() * 0.5;
        pos[i * 2] = Math.cos(a) * r;
        pos[i * 2 + 1] = Math.sin(a) * r * 0.8;
        near[i] = 1;
      } else {
        pos[i * 2] = Math.random() - 0.5;
        pos[i * 2 + 1] = Math.random() - 0.5;
      }
      rnd[i * 3] = 0.8 + Math.random() ** 2 * 1.2;
      rnd[i * 3 + 1] = 0.05 + Math.random() * 0.09;
      rnd[i * 3 + 2] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aPos', new THREE.BufferAttribute(pos, 2));
    g.setAttribute('aNearDuck', new THREE.BufferAttribute(near, 1));
    g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 3));

    const u = this.material.uniforms;
    this.dustMaterial = new THREE.ShaderMaterial({
      vertexShader: atmosphereVertexShader,
      fragmentShader: atmosphereFragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        // Shared uniform objects: updating the duck's updates the dust too.
        uTime: u.uTime,
        uAssemble: u.uAssemble,
        uScroll: u.uScroll,
        uScale: u.uScale,
        uCenter: u.uCenter,
        uPixelRatio: u.uPixelRatio,
        uDrift: u.uDrift,
        uViewport: { value: new THREE.Vector2(1, 1) },
        uColor: { value: new THREE.Vector3(...DUST_COLOR) },
      },
    });
    this.dustGeometry = g;
    this.dust = new THREE.Points(g, this.dustMaterial);
    this.dust.frustumCulled = false;
  }

  private bindEvents() {
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);

    addEventListener('pointermove', this.onPointerMove, { passive: true });
    document.addEventListener('pointerleave', this.onPointerLeave);
    addEventListener('scroll', this.onScroll, { passive: true });
    this.onScroll();

    // Stop rendering entirely once the hero is off screen.
    this.intersection = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (this.visible) this.start();
    });
    this.intersection.observe(this.container);
  }

  private resize() {
    if (!this.renderer) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h, false);
    Object.assign(this.camera, { left: -w / 2, right: w / 2, top: h / 2, bottom: -h / 2 });
    this.camera.updateProjectionMatrix();

    const wide = w > 900;
    // Duck sits right of the headline on wide screens, centered on narrow ones.
    // 4/3 keeps the current composition and just grows the bird by a third.
    const grow = 4 / 3;
    this.scale = (wide ? Math.min(h * 0.78, w * 0.48) : Math.min(h * 0.55, w * 0.9)) * grow;
    this.center = wide ? { x: w * 0.23, y: 0 } : { x: 0, y: -h * 0.12 };

    const u = this.material.uniforms;
    u.uScale.value = this.scale;
    u.uCenter.value.set(this.center.x, this.center.y);
    u.uSpread.value = Math.max(w, h) * 0.75;
    // Diameters scale with the duck so the composition looks the same at any viewport size.
    u.uSize.value = this.scale / REFERENCE_SCALE;
    this.dustMaterial.uniforms.uViewport.value.set(w, h);
    u.uPixelRatio.value = this.renderer.getPixelRatio();
  }

  private start() {
    if (this.running || !this.visible || this.disposed) return;
    this.running = true;
    this.lastTime = performance.now();
    const loop = (now: number) => {
      if (!this.visible || this.disposed) {
        this.running = false;
        return;
      }
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private frame(now: number) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    const u = this.material.uniforms;

    u.uTime.value = (now - this.startTime) / 1000;
    if (!this.reducedMotion) u.uAssemble.value = Math.min(1, (now - this.startTime) / INTRO_MS);

    // Ease scroll so dispersal glides instead of snapping to wheel steps.
    this.scroll += (this.scrollTarget - this.scroll) * (1 - Math.exp(-dt * 8));
    u.uScroll.value = this.scroll;

    this.updateSpring(dt, u.uAssemble.value);
    this.renderer!.render(this.scene, this.camera);
  }

  /** Cursor repulsion with a per-particle spring. Skips all work once everything has settled. */
  private updateSpring(dt: number, assemble: number) {
    const engaged = this.pointer.active && assemble > 0.7 && this.scroll < 0.5;
    if (!engaged && this.springAsleep) return;
    this.springAsleep = false;

    const { radius, strength, stiffness, damping } = REPEL;
    const r2 = radius * radius;
    const k = Math.min(dt * 60, 3);
    const damp = Math.pow(damping, k);
    const { x: mx, y: my } = this.pointer;
    const { x: cx, y: cy } = this.center;
    const T = this.targets, O = this.offset, V = this.velocity, s = this.scale;
    let maxMotion = 0;

    for (let i = 0; i < this.count; i++) {
      const ix = i * 2, iy = ix + 1;
      if (engaged) {
        const dx = T[ix] * s + cx + O[ix] - mx;
        const dy = T[iy] * s + cy + O[iy] - my;
        const d2 = dx * dx + dy * dy;
        if (d2 < r2) {
          const d = Math.sqrt(d2) + 0.001;
          const f = (1 - d / radius) ** 2 * strength * k;
          V[ix] += (dx / d) * f;
          V[iy] += (dy / d) * f;
        }
      }
      V[ix] = (V[ix] - O[ix] * stiffness * k) * damp;
      V[iy] = (V[iy] - O[iy] * stiffness * k) * damp;
      O[ix] += V[ix] * k;
      O[iy] += V[iy] * k;
      const m = Math.abs(O[ix]) + Math.abs(O[iy]) + Math.abs(V[ix]) + Math.abs(V[iy]);
      if (m > maxMotion) maxMotion = m;
    }

    this.offsetAttr.needsUpdate = true;
    if (!engaged && maxMotion < 0.02) {
      O.fill(0);
      V.fill(0);
      this.springAsleep = true;
    }
  }

  /** Safe to call at any point, including before init() has finished. */
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerleave', this.onPointerLeave);
    removeEventListener('scroll', this.onScroll);
    this.resizeObserver?.disconnect();
    this.intersection?.disconnect();
    if (!this.renderer) return;
    this.geometry.dispose();
    this.material.dispose();
    this.dustGeometry.dispose();
    this.dustMaterial.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
