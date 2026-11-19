import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* =========================================================
   Nebula Drift — Vedant Bhayani
   ========================================================= */

const root = document.documentElement;
const body = document.body;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const lowTier = coarse || innerWidth < 768 || (navigator.hardwareConcurrency || 8) <= 4;

const Q = lowTier
  ? { stars: 6500, octaves: 4, clouds: 24, maxPR: 1.25, bloom: 0.75 }
  : { stars: 15000, octaves: 5, clouds: 42, maxPR: 1.75, bloom: 0.9 };

document.getElementById('year').textContent = new Date().getFullYear();

/* ---------------- Loader ---------------- */
const pctEl = document.getElementById('loader-pct');
let loadShown = 0;
let loadTarget = 0.85;
let loaderDone = false;
(function loaderTick() {
  loadShown += (loadTarget - loadShown) * 0.06;
  const v = Math.min(100, Math.round(loadShown * 100));
  pctEl.textContent = v;
  if (loadTarget >= 1 && v >= 100) {
    body.classList.add('is-ready');
    loaderDone = true;
    revealHero();
    return;
  }
  requestAnimationFrame(loaderTick);
})();
function finishLoading() { loadTarget = 1; }

/* ---------------- Reveal on scroll ---------------- */
const io = new IntersectionObserver(
  (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('is-visible')),
  { threshold: 0.2 }
);
document.querySelectorAll('.section:not(.hero) .reveal').forEach((el) => io.observe(el));
function revealHero() {
  document.querySelectorAll('.hero .reveal').forEach((el) => el.classList.add('is-visible'));
}

/* ---------------- Custom cursor ---------------- */
if (!coarse) {
  const dot = document.querySelector('.cursor-dot');
  const ring = document.querySelector('.cursor-ring');
  const pos = { x: innerWidth / 2, y: innerHeight / 2 };
  const ringPos = { ...pos };
  addEventListener('pointermove', (e) => {
    pos.x = e.clientX; pos.y = e.clientY;
    body.classList.add('has-cursor');
  });
  document.addEventListener('pointerover', (e) => body.classList.toggle('is-hover', !!e.target.closest('a, button')));
  document.addEventListener('pointerleave', () => body.classList.remove('has-cursor'));
  (function cursorTick() {
    ringPos.x += (pos.x - ringPos.x) * 0.18;
    ringPos.y += (pos.y - ringPos.y) * 0.18;
    dot.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
    ring.style.transform = `translate3d(${ringPos.x}px, ${ringPos.y}px, 0)`;
    requestAnimationFrame(cursorTick);
  })();
}

/* ---------------- Scroll state ---------------- */
let pTarget = 0;
const railFill = document.getElementById('rail-fill');
function onScroll() {
  const max = root.scrollHeight - innerHeight;
  pTarget = max > 0 ? THREE.MathUtils.clamp(scrollY / max, 0, 1) : 0;
  railFill.style.transform = `scaleY(${pTarget})`;
}
addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ---------------- WebGL ---------------- */
const canvas = document.getElementById('webgl');
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
  if (!renderer.getContext()) throw new Error('No WebGL context');
} catch (err) {
  console.warn('WebGL unavailable, showing static fallback.', err);
  root.classList.add('no-webgl');
  renderer = null;
  finishLoading();
}

if (renderer) initScene();

function initScene() {
  let pixelRatio = Math.min(devicePixelRatio || 1, Q.maxPR);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 600);

  /* ---------- Shared GLSL ---------- */
  const NOISE = /* glsl */ `
    #define OCTAVES ${Q.octaves}
    float hash(vec3 p) {
      p = fract(p * 0.3183099 + 0.1);
      p *= 17.0;
      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }
    float noise(vec3 x) {
      vec3 i = floor(x);
      vec3 f = fract(x);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
            mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
        mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
            mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
    }
    float fbm(vec3 p) {
      float a = 0.5, s = 0.0;
      for (int i = 0; i < OCTAVES; i++) {
        s += a * noise(p);
        p = p * 2.03 + vec3(1.7, 9.2, 3.1);
        a *= 0.5;
      }
      return s;
    }
  `;

  /* ---------- Palettes per sector (deep, mid, highlight) ---------- */
  const PALETTES = [
    ['#021a2b', '#0fb5ae', '#9ff6ff'], // teal — origin
    ['#12052e', '#6d3cff', '#d6b8ff'], // violet — about
    ['#2a0322', '#ff2e88', '#ffc2e2'], // magenta — work
    ['#2a1102', '#ff8a1f', '#ffe0a3'], // amber — skills
    ['#03122a', '#3fa7ff', '#e6f4ff'], // ice — contact
  ].map((p) => p.map((h) => new THREE.Color(h)));

  const U = {
    uTime: { value: 0 },
    uColA: { value: new THREE.Color() },
    uColB: { value: new THREE.Color() },
    uColC: { value: new THREE.Color() },
  };
  function applyPalette(t) {
    const s = THREE.MathUtils.clamp(t, 0, 1) * (PALETTES.length - 1);
    const i = Math.min(Math.floor(s), PALETTES.length - 2);
    let f = s - i;
    f = f * f * (3 - 2 * f);
    U.uColA.value.copy(PALETTES[i][0]).lerp(PALETTES[i + 1][0], f);
    U.uColB.value.copy(PALETTES[i][1]).lerp(PALETTES[i + 1][1], f);
    U.uColC.value.copy(PALETTES[i][2]).lerp(PALETTES[i + 1][2], f);
  }
  applyPalette(0);

  /* ---------- Background nebula (fullscreen) ---------- */
  const bgMat = new THREE.ShaderMaterial({
    uniforms: {
      ...U,
      uProgress: { value: 0 },
      uRes: { value: new THREE.Vector2(innerWidth, innerHeight) },
      uMouse: { value: new THREE.Vector2() },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uProgress;
      uniform vec2 uRes, uMouse;
      uniform vec3 uColA, uColB, uColC;
      varying vec2 vUv;
      ${NOISE}
      void main() {
        vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
        p += uMouse * 0.04;
        float z = uProgress * 7.0 + uTime * 0.015;
        vec3 q = vec3(p * 1.5, z);
        vec2 w = vec2(fbm(q + vec3(0.0, 0.0, uTime * 0.02)), fbm(q + vec3(5.2, 1.3, 2.8)));
        float n = fbm(q + vec3(w * 1.9, 0.0));
        float density = smoothstep(0.32, 0.92, n);
        vec3 col = mix(uColA * 1.6, uColB, smoothstep(0.35, 0.75, w.x));
        col = mix(col, uColC, smoothstep(0.62, 0.95, n) * 0.75);
        col *= density * 1.15;
        float dust = smoothstep(0.42, 0.72, fbm(q * 2.6 + vec3(w * 2.0, 1.0)));
        col *= mix(1.0, 0.3, dust);
        col += uColA * 0.35;
        float v = length(vUv - 0.5);
        col *= 1.0 - v * 0.6;
        gl_FragColor = vec4(col * 0.8, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat);
  bg.frustumCulled = false;
  bg.renderOrder = -10;
  scene.add(bg);

  /* ---------- Volumetric cloud billboards ---------- */
  const PATH_LEN = 360;
  const START_Z = 8;
  {
    const n = Q.clouds;
    const geo = new THREE.PlaneGeometry(1, 1);
    const seeds = new Float32Array(n);
    const tints = new Float32Array(n);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...U, uIntensity: { value: 0.55 } },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        attribute float aTint;
        varying vec2 vUv;
        varying float vSeed, vTint, vFade;
        void main() {
          vUv = uv; vSeed = aSeed; vTint = aTint;
          vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float scale = length(instanceMatrix[0].xyz);
          vec4 mv = center + vec4(position.xy * scale, 0.0, 0.0);
          float d = -center.z;
          vFade = smoothstep(3.0, 22.0, d) * (1.0 - smoothstep(130.0, 220.0, d));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime, uIntensity;
        uniform vec3 uColA, uColB, uColC;
        varying vec2 vUv;
        varying float vSeed, vTint, vFade;
        ${NOISE}
        void main() {
          if (vFade <= 0.001) discard;
          vec2 c = vUv - 0.5;
          float r = length(c) * 2.0;
          float fall = smoothstep(1.0, 0.0, r);
          fall *= fall;
          float a = vSeed * 6.2831;
          mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
          vec2 p = R * c * 3.0;
          float n = fbm(vec3(p, vSeed * 17.0 + uTime * 0.04));
          float d = smoothstep(0.38, 0.9, n) * fall;
          vec3 col = mix(uColB, uColC, vTint * 0.55) * d;
          gl_FragColor = vec4(col * uIntensity * vFade, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const z = START_Z + 10 - (i / n) * (PATH_LEN + 80) - Math.random() * 8;
      const ang = Math.random() * Math.PI * 2;
      const r = 9 + Math.random() * 26;
      pos.set(Math.cos(ang) * r, Math.sin(ang) * r * 0.7, z);
      const s = 18 + Math.random() * 30;
      scl.set(s, s, s);
      m.compose(pos, quat, scl);
      mesh.setMatrixAt(i, m);
      seeds[i] = Math.random();
      tints[i] = Math.random();
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 1));
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    scene.add(mesh);
  }

  /* ---------- Star field ---------- */
  const starMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: U.uTime,
      uPR: { value: pixelRatio },
      uTwinkle: { value: reduceMotion ? 0.0 : 1.0 },
    },
    vertexShader: /* glsl */ `
      attribute float aSize, aSeed;
      attribute vec3 aColor;
      uniform float uTime, uPR, uTwinkle;
      varying vec3 vColor;
      varying float vB;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float tw = 1.0 - uTwinkle * 0.45 * (0.5 + 0.5 * sin(uTime * (0.8 + aSeed * 3.0) + aSeed * 60.0));
        float dist = max(-mv.z, 0.001);
        float size = aSize * uPR * (140.0 / dist);
        vB = tw * smoothstep(0.3, 5.0, dist);
        if (size < 1.0) { vB *= size; size = 1.0; }
        gl_PointSize = min(size, 26.0 * uPR);
        vColor = aColor;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vB;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float core = exp(-d * d * 60.0);
        float halo = exp(-d * d * 10.0) * 0.35;
        gl_FragColor = vec4(vColor * (core * 1.7 + halo) * vB, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const STAR_TEMPS = ['#9bb0ff', '#aabfff', '#cad7ff', '#f8f7ff', '#fff4ea', '#ffd2a1', '#ffcc6f'].map((h) => new THREE.Color(h));
  function makeStarGeometry(count, placer) {
    const g = new THREE.BufferGeometry();
    const position = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const seed = new Float32Array(count);
    const color = new Float32Array(count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      placer(v, i);
      position.set([v.x, v.y, v.z], i * 3);
      size[i] = 0.5 + Math.pow(Math.random(), 5) * 3.4;
      seed[i] = Math.random();
      const c = STAR_TEMPS[Math.floor(Math.pow(Math.random(), 0.8) * STAR_TEMPS.length)];
      color.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    return g;
  }
  const stars = new THREE.Points(
    makeStarGeometry(Q.stars, (v) => {
      const z = START_Z + 30 - Math.random() * (PATH_LEN + 140);
      const r = 2.5 + Math.pow(Math.random(), 0.65) * 95;
      const a = Math.random() * Math.PI * 2;
      v.set(Math.cos(a) * r, Math.sin(a) * r, z);
    }),
    starMat
  );
  stars.frustumCulled = false;
  stars.renderOrder = 3;
  scene.add(stars);

  /* ---------- Planets (one per sector) ---------- */
  const planetVert = /* glsl */ `
    varying vec3 vNormal, vPos, vView;
    void main() {
      vPos = position;
      vNormal = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vView = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }
  `;
  const planetFrag = /* glsl */ `
    uniform vec3 uDeep, uMid, uHi;
    uniform float uTime, uSeed;
    varying vec3 vNormal, vPos, vView;
    ${NOISE}
    void main() {
      vec3 p = normalize(vPos);
      float t = uTime * 0.03;
      vec3 q = p * 2.2 + vec3(uSeed * 10.0);
      float w = fbm(q + vec3(t, 0.0, 0.0));
      float bands = fbm(vec3(p.y * 5.5 + w * 2.6, p.x * 0.9 + t, p.z * 0.9 + uSeed));
      vec3 col = mix(uDeep * 1.6, uMid, smoothstep(0.3, 0.75, bands));
      col = mix(col, uHi, smoothstep(0.66, 0.9, bands) * 0.65);
      vec3 L = normalize(vec3(-0.55, 0.45, 0.7));
      float term = smoothstep(-0.15, 0.55, dot(vNormal, L));
      col *= 0.05 + term * 1.15;
      float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 3.0);
      col += uMid * fres * 1.5 * (0.25 + term);
      gl_FragColor = vec4(col, 1.0);
    }
  `;
  const atmoFrag = /* glsl */ `
    uniform vec3 uMid, uHi;
    varying vec3 vNormal, vPos, vView;
    void main() {
      float d = clamp(-dot(vNormal, vView), 0.0, 1.0);
      float i = pow(d, 2.4) * 2.6;
      gl_FragColor = vec4(mix(uMid, uHi, 0.35) * i, 1.0);
    }
  `;

  const planetDefs = [
    { r: 3.3, x: 4.6, y: 0.1, dz: 24, ring: true },
    { r: 1.9, x: -6.2, y: 1.6, dz: 26 },
    { r: 2.5, x: 6.6, y: -1.4, dz: 28 },
    { r: 1.6, x: -5.4, y: -1.9, dz: 24 },
    { r: 2.9, x: 5.4, y: 1.9, dz: 30, ring: true },
  ];
  const sphereGeo = new THREE.SphereGeometry(1, lowTier ? 64 : 128, lowTier ? 48 : 96);
  const planets = planetDefs.map((def, i) => {
    const pal = PALETTES[i];
    const group = new THREE.Group();
    const uniforms = {
      uTime: U.uTime,
      uSeed: { value: i * 1.37 + 0.3 },
      uDeep: { value: pal[0] },
      uMid: { value: pal[1] },
      uHi: { value: pal[2] },
    };
    const surface = new THREE.Mesh(sphereGeo, new THREE.ShaderMaterial({ uniforms, vertexShader: planetVert, fragmentShader: planetFrag }));
    surface.scale.setScalar(def.r);
    const atmo = new THREE.Mesh(
      sphereGeo,
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: planetVert,
        fragmentShader: atmoFrag,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    atmo.scale.setScalar(def.r * 1.28);
    group.add(surface, atmo);
    if (def.ring) {
      const ring = new THREE.Points(
        makeStarGeometry(lowTier ? 2500 : 6000, (v) => {
          const a = Math.random() * Math.PI * 2;
          const rr = def.r * (1.6 + Math.pow(Math.random(), 1.4) * 1.3);
          v.set(Math.cos(a) * rr, (Math.random() - 0.5) * 0.08, Math.sin(a) * rr);
        }),
        starMat
      );
      ring.rotation.set(0.38, 0, -0.32);
      ring.userData.spin = true;
      group.add(ring);
    }
    group.userData = { def, surface, baseZ: START_Z - (i / (planetDefs.length - 1)) * PATH_LEN - def.dz };
    group.position.set(def.x, def.y, group.userData.baseZ);
    scene.add(group);
    return group;
  });

  function layoutPlanets() {
    const portrait = innerWidth / innerHeight < 1;
    planets.forEach((g, i) => {
      const { def, baseZ } = g.userData;
      if (portrait) {
        g.position.set(i === 0 ? 0 : def.x * 0.45, i === 0 ? 2.6 : def.y * 0.8 + 1.2, baseZ);
      } else {
        g.position.set(def.x, def.y, baseZ);
      }
    });
  }
  layoutPlanets();

  /* ---------- Post-processing ---------- */
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), Q.bloom, 0.65, 0.18);
  composer.addPass(bloom);
  const finalPass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uGrain: { value: reduceMotion ? 0.02 : 0.035 },
      uCA: { value: lowTier ? 0.006 : 0.01 },
      uRes: { value: new THREE.Vector2(innerWidth * pixelRatio, innerHeight * pixelRatio) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float uTime, uGrain, uCA;
      uniform vec2 uRes;
      varying vec2 vUv;
      void main() {
        vec2 c = vUv - 0.5;
        float d = dot(c, c);
        vec2 off = c * d * uCA * 4.0;
        vec3 col;
        col.r = texture2D(tDiffuse, vUv + off).r;
        col.g = texture2D(tDiffuse, vUv).g;
        col.b = texture2D(tDiffuse, vUv - off).b;
        col *= 1.0 - d * 1.15;
        float g = fract(sin(dot(vUv * uRes + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
        col += (g - 0.5) * uGrain;
        gl_FragColor = vec4(max(col, 0.0), 1.0);
      }
    `,
  });
  composer.addPass(finalPass);
  composer.addPass(new OutputPass());

  /* ---------- Input ---------- */
  const mouse = new THREE.Vector2();
  const mouseSmooth = new THREE.Vector2();
  addEventListener('pointermove', (e) => {
    mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  });

  /* ---------- Resize ---------- */
  function resize() {
    const w = innerWidth, h = innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(w, h);
    bgMat.uniforms.uRes.value.set(w, h);
    finalPass.uniforms.uRes.value.set(w * pixelRatio, h * pixelRatio);
    starMat.uniforms.uPR.value = pixelRatio;
    layoutPlanets();
    onScroll();
  }
  addEventListener('resize', resize);

  /* ---------- HUD ---------- */
  const hudDepth = document.getElementById('hud-depth');
  const hudVel = document.getElementById('hud-vel');
  const hudSector = document.getElementById('hud-sector');
  let hudCache = '';

  /* ---------- Loop ---------- */
  const clock = new THREE.Clock();
  let time = 0;
  let p = pTarget;
  let pPrev = p;
  let vel = 0;
  let frames = 0, frameTimeSum = 0, adapted = false;
  const lookTarget = new THREE.Vector3();

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    time += reduceMotion ? dt * 0.3 : dt;
    U.uTime.value = time;
    finalPass.uniforms.uTime.value = time;

    // Smoothed scroll progress
    p += (pTarget - p) * (reduceMotion ? 1 : 1 - Math.exp(-dt * 3.2));
    const instVel = dt > 0 ? Math.abs(p - pPrev) / dt : 0;
    vel += (instVel - vel) * 0.08;
    pPrev = p;

    mouseSmooth.lerp(mouse, reduceMotion ? 0 : 0.05);
    const drift = coarse && !reduceMotion ? new THREE.Vector2(Math.sin(time * 0.3) * 0.3, Math.cos(time * 0.23) * 0.2) : mouseSmooth;

    // Camera flight path
    const cx = Math.sin(p * Math.PI * 2) * 1.6 + drift.x * 0.7;
    const cy = Math.cos(p * Math.PI * 3) * 0.9 - 0.9 + drift.y * 0.45;
    const cz = START_Z - p * PATH_LEN;
    camera.position.set(cx, cy, cz);
    lookTarget.set(cx * 0.4 + drift.x * 0.8, cy * 0.4 + drift.y * 0.5, cz - 20);
    camera.lookAt(lookTarget);
    camera.rotation.z += Math.sin(p * Math.PI * 2) * 0.04;
    const targetFov = 50 + Math.min(vel * 45, 14);
    camera.fov += (targetFov - camera.fov) * 0.1;
    camera.updateProjectionMatrix();

    // Colour mood
    applyPalette(p);
    bgMat.uniforms.uProgress.value = p;
    bgMat.uniforms.uMouse.value.copy(drift);

    // Planets
    planets.forEach((g, i) => {
      g.userData.surface.rotation.y = time * (0.05 + i * 0.012);
      g.children.forEach((c) => { if (c.userData.spin) c.rotation.y = time * 0.04; });
    });

    // HUD
    const depth = (p * 4.2).toFixed(2);
    const v = Math.min(vel * 2.4, 0.999).toFixed(3);
    const sector = String(Math.min(5, Math.round(p * 4) + 1)).padStart(2, '0');
    const key = depth + v + sector;
    if (key !== hudCache) {
      hudCache = key;
      hudDepth.textContent = `${depth} ly`;
      hudVel.textContent = `${v} c`;
      hudSector.textContent = `${sector} / 05`;
    }

    composer.render(dt);

    // Adaptive quality: if the first ~90 frames are slow, drop resolution.
    if (!adapted && loaderDone) {
      frames++;
      frameTimeSum += dt;
      if (frames >= 90) {
        adapted = true;
        const avg = frameTimeSum / frames;
        if (avg > 0.024 && pixelRatio > 1) {
          pixelRatio = 1;
          resize();
        } else if (avg > 0.03) {
          pixelRatio = Math.max(0.75, pixelRatio * 0.8);
          bloom.strength *= 0.85;
          resize();
        }
      }
    }

    requestAnimationFrame(frame);
  }

  // Compile shaders up front, then start.
  loadTarget = 0.95;
  try { renderer.compile(scene, camera); } catch (e) { /* non-fatal */ }
  requestAnimationFrame(() => {
    frame();
    setTimeout(finishLoading, 250);
  });

  // Pause GPU work when the tab is hidden.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) clock.getDelta(); });
}
