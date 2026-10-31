import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// One hue per visit. The sky and every stroke are shades of it.
const hue = Math.random();
document.body.style.setProperty("--hue", String(Math.round(hue * 360)));

const tubes = [
  {
    color: shadeColor(0.92),
    radius: 0.088,
    from: [-1.7, 0.35, 2.05],
    to: [1.75, -1.05, 1.88],
    waves: [
      { axis: 0, freq: 0.7, amp: 0.2, phase: 0.4, speed: 0.28 },
      { axis: 1, freq: 0.95, amp: 0.22, phase: 1.4, speed: 0.22 },
      { axis: 2, freq: 0.45, amp: 0.08, phase: 0.5, speed: 0.16 },
    ],
  },
  {
    color: shadeColor(0.74),
    radius: 0.07,
    from: [-1.8, -0.45, 1.15],
    to: [1.7, 2.15, 1.02],
    waves: [
      { axis: 0, freq: 0.65, amp: 0.18, phase: 2.0, speed: 0.2 },
      { axis: 1, freq: 1.0, amp: 0.16, phase: 0.5, speed: 0.34 },
      { axis: 2, freq: 0.5, amp: 0.07, phase: 1.2, speed: 0.18 },
    ],
  },
  {
    color: shadeColor(0.56),
    radius: 0.08,
    from: [-1.8, 0.55, 0.06],
    to: [1.8, -0.65, -0.06],
    waves: [
      { axis: 0, freq: 0.8, amp: 0.14, phase: 0.8, speed: 0.26 },
      { axis: 1, freq: 0.62, amp: 0.32, phase: 2.2, speed: 0.3 },
      { axis: 2, freq: 0.55, amp: 0.08, phase: 0.2, speed: 0.14 },
    ],
  },
  {
    color: shadeColor(0.4),
    radius: 0.062,
    from: [-1.7, -1.75, 0.38],
    to: [1.75, 0.35, 0.26],
    waves: [
      { axis: 0, freq: 0.6, amp: 0.16, phase: 1.7, speed: 0.22 },
      { axis: 1, freq: 0.9, amp: 0.26, phase: 0.3, speed: 0.36 },
      { axis: 2, freq: 0.5, amp: 0.06, phase: 2.1, speed: 0.15 },
    ],
  },
  {
    color: shadeColor(0.24),
    radius: 0.056,
    from: [2.0, -0.35, -1.05],
    to: [-2.0, 2.45, -0.9],
    waves: [
      { axis: 0, freq: 1.05, amp: 0.24, phase: 0.6, speed: 0.32 },
      { axis: 1, freq: 0.7, amp: 0.16, phase: 1.8, speed: 0.24 },
      { axis: 2, freq: 0.45, amp: 0.07, phase: 0.9, speed: 0.16 },
    ],
  },
  {
    color: shadeColor(0.1),
    radius: 0.052,
    from: [2.4, -2.6, -1.95],
    to: [-2.45, 2.35, -1.78],
    waves: [
      { axis: 0, freq: 0.85, amp: 0.22, phase: 2.5, speed: 0.26 },
      { axis: 1, freq: 0.75, amp: 0.18, phase: 0.7, speed: 0.3 },
      { axis: 2, freq: 0.4, amp: 0.08, phase: 1.5, speed: 0.14 },
    ],
  },
];

const PATH_SAMPLES = 40;
const RADIAL = 8;
const TAPER_END = 0.12;
const CAMERA_DISTANCE = 4.6;
const _point = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _binormal = new THREE.Vector3();

async function startStrokes(canvas) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);
  camera.position.set(0, 0, CAMERA_DISTANCE);

  const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMaterial());
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);

  const group = new THREE.Group();
  scene.add(group);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.55);
  key.position.set(0.6, 1.4, 1.2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.4);
  fill.position.set(-1.1, -0.4, 0.6);
  scene.add(fill);

  const logoTexture = await loadLogo();
  logoTexture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  // Nearest keeps letter alpha crisp for depth discard (avoids mip bleed boxing DOF).
  logoTexture.minFilter = THREE.LinearFilter;
  logoTexture.generateMipmaps = false;
  const logo = new THREE.Mesh(
    new THREE.PlaneGeometry(1, logoTexture.image.height / logoTexture.image.width),
    new THREE.MeshBasicMaterial({
      map: logoTexture,
      // alphaTest without transparent keeps the mark in the opaque pass so
      // nearer tubes can occlude it correctly.
      alphaTest: 0.5,
      depthWrite: true,
      depthTest: true,
    }),
  );
  logo.position.z = 0.02;
  group.add(logo);

  // Custom depth shader discards clear texels so the plane never stamps a
  // rectangular focus box into the BokehPass depth buffer.
  const logoDepth = logoDepthMaterial(logoTexture);

  const strokes = tubes.map((tube) => {
    const curve = new StrokeCurve(tube);
    const geometry = createTubeGeometry(curve, tube.radius);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setRGB(tube.color[0], tube.color[1], tube.color[2], THREE.SRGBColorSpace),
      roughness: 0.38,
      metalness: 0.04,
    });
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);
    return { tube, curve, mesh, geometry };
  });

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bokeh = new BokehPass(scene, camera, {
    focus: CAMERA_DISTANCE,
    aperture: 0.045,
    maxblur: 0.012,
  });
  composer.addPass(bokeh);
  composer.addPass(new OutputPass());

  // Sky is only fullscreen in its own shader; hide it for depth or it stamps a
  // sharp rectangle. Logo letters are drawn with alpha so empty plane is ignored.
  bokeh.render = function (renderer, writeBuffer, readBuffer) {
    this.scene.overrideMaterial = this.materialDepth;
    logo.visible = false;
    sky.visible = false;

    renderer.getClearColor(this._oldClearColor);
    const oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(0xffffff);
    renderer.setClearAlpha(1);
    renderer.setRenderTarget(this.renderTargetDepth);
    renderer.clear();
    renderer.render(this.scene, this.camera);

    this.scene.overrideMaterial = null;
    logo.visible = true;
    for (const stroke of strokes) stroke.mesh.visible = false;
    const colorMaterial = logo.material;
    logo.material = logoDepth;
    renderer.render(this.scene, this.camera);
    logo.material = colorMaterial;
    for (const stroke of strokes) stroke.mesh.visible = true;
    sky.visible = true;

    this.uniforms.tColor.value = readBuffer.texture;
    this.uniforms.nearClip.value = this.camera.near;
    this.uniforms.farClip.value = this.camera.far;

    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (!this.renderToScreen) renderer.clear();
    this.fsQuad.render(renderer);

    renderer.setClearColor(this._oldClearColor);
    renderer.setClearAlpha(oldClearAlpha);
    renderer.autoClear = oldAutoClear;
  };

  const pointer = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };
  const logoWorld = new THREE.Vector3();
  const logoView = new THREE.Vector3();
  let aspect = 1;
  let running = true;

  function rebuildStrokes() {
    for (const stroke of strokes) {
      stroke.curve.elapsed = 0;
      stroke.curve.aspect = aspect;
      updateTubeGeometry(stroke.geometry, stroke.curve, stroke.tube.radius);
    }
  }

  function resize() {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    aspect = width / height;
    camera.aspect = aspect;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(1.2 / CAMERA_DISTANCE));
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    bokeh.uniforms.aspect.value = camera.aspect;
    const cssWidth = Math.min(width * 0.62, 28 * parseFloat(getComputedStyle(document.documentElement).fontSize));
    logo.scale.setScalar((cssWidth / width) * 2.4 * aspect);
    rebuildStrokes();
  }

  function frame() {
    if (!running) return;
    const sway = reduce ? 0 : 1;
    current.x += ((reduce ? 0 : pointer.x) - current.x) * 0.12;
    current.y += ((reduce ? 0 : pointer.y) - current.y) * 0.12;

    // Parallax from the camera only — strokes and logo stay fixed in world space.
    camera.position.x = current.x * 1.15 * sway;
    camera.position.y = current.y * -0.75 * sway;
    camera.position.z = CAMERA_DISTANCE;
    logoWorld.set(0, 0, logo.position.z);
    camera.lookAt(logoWorld);
    camera.updateMatrixWorld();
    logoView.copy(logoWorld).applyMatrix4(camera.matrixWorldInverse);
    bokeh.uniforms.focus.value = -logoView.z;
    sky.material.uniforms.shift.value.set(current.x * -0.12, current.y * 0.08);

    composer.render();
    requestAnimationFrame(frame);
  }

  resize();
  requestAnimationFrame(frame);

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas.parentElement || canvas);

  window.addEventListener("pointermove", (event) => {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
  });

  document.addEventListener("visibilitychange", () => {
    const hidden = document.hidden;
    if (!hidden && !running) {
      running = true;
      requestAnimationFrame(frame);
    }
    running = !hidden;
  });
}

function createTubeGeometry(curve, radius) {
  const geometry = new THREE.BufferGeometry();
  const frames = curve.computeFrenetFrames(PATH_SAMPLES, false);
  const verts = (PATH_SAMPLES + 1) * RADIAL;
  const positions = new Float32Array(verts * 3);
  const normals = new Float32Array(verts * 3);
  const uvs = new Float32Array(verts * 2);
  const indices = [];

  for (let i = 0; i < PATH_SAMPLES; i++) {
    for (let j = 0; j < RADIAL; j++) {
      const a = i * RADIAL + j;
      const b = i * RADIAL + ((j + 1) % RADIAL);
      const c = (i + 1) * RADIAL + ((j + 1) % RADIAL);
      const d = (i + 1) * RADIAL + j;
      indices.push(a, b, d, b, c, d);
    }
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.userData.frames = frames;
  updateTubeGeometry(geometry, curve, radius);
  return geometry;
}

function endTaper(t) {
  // Full radius across the middle; pinch only in the outer ~12% at each tip.
  if (t < TAPER_END) {
    const u = t / TAPER_END;
    return u * u * (3 - 2 * u);
  }
  if (t > 1 - TAPER_END) {
    const u = (1 - t) / TAPER_END;
    return u * u * (3 - 2 * u);
  }
  return 1;
}

function updateTubeGeometry(geometry, curve, radius) {
  const frames = curve.computeFrenetFrames(PATH_SAMPLES, false);
  const positions = geometry.attributes.position.array;
  const normals = geometry.attributes.normal.array;
  const uvs = geometry.attributes.uv.array;

  for (let i = 0; i <= PATH_SAMPLES; i++) {
    const t = i / PATH_SAMPLES;
    const girth = radius * endTaper(t);
    curve.getPoint(t, _point);
    _normal.copy(frames.normals[i]);
    _binormal.copy(frames.binormals[i]);
    for (let j = 0; j < RADIAL; j++) {
      const angle = (j / RADIAL) * Math.PI * 2;
      const cx = Math.cos(angle);
      const sx = Math.sin(angle);
      const idx = (i * RADIAL + j) * 3;
      const nx = cx * _normal.x + sx * _binormal.x;
      const ny = cx * _normal.y + sx * _binormal.y;
      const nz = cx * _normal.z + sx * _binormal.z;
      positions[idx] = _point.x + girth * nx;
      positions[idx + 1] = _point.y + girth * ny;
      positions[idx + 2] = _point.z + girth * nz;
      normals[idx] = nx;
      normals[idx + 1] = ny;
      normals[idx + 2] = nz;
      const uv = (i * RADIAL + j) * 2;
      uvs[uv] = j / RADIAL;
      uvs[uv + 1] = t;
    }
  }

  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.normal.needsUpdate = true;
  geometry.attributes.uv.needsUpdate = true;
  geometry.computeBoundingSphere();
}

class StrokeCurve extends THREE.Curve {
  constructor(tube) {
    super();
    this.tube = tube;
    this.elapsed = 0;
    this.aspect = 1;
  }

  getPoint(t, target = new THREE.Vector3()) {
    const from = this.tube.from;
    const to = this.tube.to;
    const point = [
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t,
    ];
    for (const wave of this.tube.waves) {
      // Elapsed stays frozen at 0 so paths are static after build.
      point[wave.axis] += Math.sin(t * Math.PI * 2 * wave.freq + wave.phase) * wave.amp;
    }
    return target.set(point[0] * this.aspect, point[1], point[2]);
  }
}

function logoDepthMaterial(texture) {
  return new THREE.ShaderMaterial({
    uniforms: { tMap: { value: texture } },
    toneMapped: false,
    blending: THREE.NoBlending,
    depthTest: true,
    depthWrite: true,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      #include <packing>
      uniform sampler2D tMap;
      varying vec2 vUv;

      void main() {
        if (texture2D(tMap, vUv).a < 0.5) discard;
        gl_FragColor = packDepthToRGBA(gl_FragCoord.z);
      }
    `,
  });
}

function skyMaterial() {
  const uniforms = {
    zenith: { value: cssColor(hue, 0.62, 0.64) },
    high: { value: cssColor(hue, 0.4, 0.82) },
    mist: { value: cssColor(hue, 0.18, 0.94) },
    earthCore: { value: cssColor(hue, 0.58, 0.38) },
    earth: { value: cssColor(hue, 0.48, 0.52) },
    limb: { value: cssColor(hue, 0.42, 0.74) },
    shift: { value: new THREE.Vector2() },
  };

  return new THREE.ShaderMaterial({
    depthWrite: false,
    depthTest: false,
    uniforms,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.999, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 zenith;
      uniform vec3 high;
      uniform vec3 mist;
      uniform vec3 earthCore;
      uniform vec3 earth;
      uniform vec3 limb;
      uniform vec2 shift;
      varying vec2 vUv;

      void main() {
        vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
        vec3 sky = mix(zenith, high, smoothstep(0.0, 0.40, uv.y));
        sky = mix(sky, mist, smoothstep(0.40, 1.0, uv.y));

        vec2 delta = (uv - vec2(0.5, 1.28) - shift) / vec2(0.72, 0.70);
        float radius = length(delta);
        vec3 disk = mix(earthCore, earth, smoothstep(0.48, 0.66, radius));
        disk = mix(disk, limb, smoothstep(0.66, 0.80, radius));
        float cover = 1.0 - smoothstep(0.80, 0.90, radius);
        gl_FragColor = vec4(mix(sky, disk, cover), 1.0);
      }
    `,
  });
}

async function loadLogo() {
  const response = await fetch("./logotype.svg");
  const blob = new Blob([await response.text()], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.src = url;
  await image.decode();
  URL.revokeObjectURL(url);

  const drawn = document.createElement("canvas");
  drawn.width = 2080;
  drawn.height = 685;
  const context = drawn.getContext("2d");
  context.clearRect(0, 0, drawn.width, drawn.height);
  context.drawImage(image, 0, 0, 2080, 685);

  const texture = new THREE.CanvasTexture(drawn);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function cssColor(h, s, l) {
  return new THREE.Color().setRGB(...hslToRgb(h, s, l), THREE.SRGBColorSpace);
}

function shadeColor(step) {
  const saturation = 0.46 + 0.28 * Math.sin(step * Math.PI);
  const lightness = 0.32 + step * 0.5;
  return hslToRgb(hue, saturation, lightness);
}

function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

const canvas = document.getElementById("strokes");
if (canvas instanceof HTMLCanvasElement) startStrokes(canvas);
