import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// One hue per visit. The sky and every stroke are shades of it.
const hue = Math.random();
document.body.style.setProperty("--hue", String(Math.round(hue * 360)));

// Styles echo the app brushes: pen, ribbon, helix, twin, clouds, stars.
// Layout is rolled fresh each visit — paths, depths, and which brushes show.
const strokeDefs = makeStrokeDefs();

const PATH_SAMPLES = 48;
const RADIAL = 8;
const RIBBON_SAMPLES = 56;
const TAPER_END = 0.12;
const CAMERA_DISTANCE = 4.6;
const _point = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _binormal = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _matrix = new THREE.Matrix4();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();

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

  const strokes = strokeDefs.map((def) => {
    const stroke = buildStroke(def);
    group.add(stroke.root);
    return stroke;
  });
  const strokeMeshes = strokes.flatMap((stroke) => stroke.meshes);

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
    for (const mesh of strokeMeshes) mesh.visible = false;
    const colorMaterial = logo.material;
    logo.material = logoDepth;
    renderer.render(this.scene, this.camera);
    logo.material = colorMaterial;
    for (const mesh of strokeMeshes) mesh.visible = true;
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
    for (const stroke of strokes) stroke.rebuild(aspect);
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

function paintMaterial(color, extras = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(color[0], color[1], color[2], THREE.SRGBColorSpace),
    roughness: extras.roughness ?? 0.38,
    metalness: extras.metalness ?? 0.04,
    emissive: extras.emissive ?? new THREE.Color(0x000000),
    emissiveIntensity: extras.emissiveIntensity ?? 0,
    transparent: extras.transparent ?? false,
    opacity: extras.opacity ?? 1,
    side: extras.side ?? THREE.FrontSide,
    depthWrite: extras.depthWrite ?? true,
  });
}

function buildStroke(def) {
  const curve = new StrokeCurve(def);
  const root = new THREE.Group();
  const meshes = [];

  if (def.style === "ribbon") {
    const geometry = createRibbonGeometry(curve, def.width, def.thickness);
    const mesh = new THREE.Mesh(geometry, paintMaterial(def.color, { side: THREE.DoubleSide, roughness: 0.45 }));
    root.add(mesh);
    meshes.push(mesh);
    return {
      root,
      meshes,
      rebuild(aspect) {
        curve.aspect = aspect;
        updateRibbonGeometry(geometry, curve, def.width, def.thickness);
      },
    };
  }

  if (def.style === "cloud" || def.style === "stars") {
    const count = def.count;
    const sphere = new THREE.SphereGeometry(1, 12, 10);
    const material = paintMaterial(def.color, {
      roughness: def.style === "stars" ? 0.2 : 0.55,
      metalness: def.style === "stars" ? 0.35 : 0.02,
      emissive: def.style === "stars" ? new THREE.Color().setRGB(def.color[0], def.color[1], def.color[2], THREE.SRGBColorSpace) : undefined,
      emissiveIntensity: def.style === "stars" ? 0.35 : 0,
    });
    const instanced = new THREE.InstancedMesh(sphere, material, count);
    instanced.frustumCulled = false;
    root.add(instanced);
    meshes.push(instanced);
    return {
      root,
      meshes,
      rebuild(aspect) {
        curve.aspect = aspect;
        placeSpheres(
          instanced,
          curve,
          def.radius,
          count,
          def.style === "stars" ? 0.55 : 1,
          def.seed ?? 1,
        );
      },
    };
  }

  if (def.style === "helix" || def.style === "twin") {
    const strands = [-1, 1].map((sign) => {
      const geometry = createTubeGeometry();
      const mesh = new THREE.Mesh(geometry, paintMaterial(def.color));
      root.add(mesh);
      meshes.push(mesh);
      return { geometry, sign };
    });
    return {
      root,
      meshes,
      rebuild(aspect) {
        curve.aspect = aspect;
        for (const strand of strands) {
          updateTubeGeometry(strand.geometry, curve, def.radius, (t, frames, i) => {
            const angle = def.style === "helix" ? t * Math.PI * 2 * def.twists + (strand.sign < 0 ? Math.PI : 0) : Math.PI * 0.5;
            const amount = def.spread * endTaper(t);
            if (def.style === "twin") {
              _offset.copy(frames.binormals[i]).multiplyScalar(strand.sign * amount);
            } else {
              _offset
                .copy(frames.normals[i])
                .multiplyScalar(Math.cos(angle) * amount)
                .addScaledVector(frames.binormals[i], Math.sin(angle) * amount);
            }
            return _offset;
          });
        }
      },
    };
  }

  const geometry = createTubeGeometry();
  const mesh = new THREE.Mesh(geometry, paintMaterial(def.color));
  root.add(mesh);
  meshes.push(mesh);
  return {
    root,
    meshes,
    rebuild(aspect) {
      curve.aspect = aspect;
      updateTubeGeometry(geometry, curve, def.radius);
    },
  };
}

function createTubeGeometry() {
  const geometry = new THREE.BufferGeometry();
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
  return geometry;
}

function createRibbonGeometry(curve, width, thickness) {
  const geometry = new THREE.BufferGeometry();
  const rings = RIBBON_SAMPLES + 1;
  const positions = new Float32Array(rings * 4 * 3);
  const normals = new Float32Array(rings * 4 * 3);
  const uvs = new Float32Array(rings * 4 * 2);
  const indices = [];
  for (let i = 0; i < RIBBON_SAMPLES; i++) {
    const a = i * 4;
    indices.push(a, a + 1, a + 5, a, a + 5, a + 4);
    indices.push(a + 1, a + 2, a + 6, a + 1, a + 6, a + 5);
    indices.push(a + 2, a + 3, a + 7, a + 2, a + 7, a + 6);
    indices.push(a + 3, a, a + 4, a + 3, a + 4, a + 7);
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  updateRibbonGeometry(geometry, curve, width, thickness);
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

function updateTubeGeometry(geometry, curve, radius, offsetAt) {
  const frames = curve.computeFrenetFrames(PATH_SAMPLES, false);
  const positions = geometry.attributes.position.array;
  const normals = geometry.attributes.normal.array;
  const uvs = geometry.attributes.uv.array;

  for (let i = 0; i <= PATH_SAMPLES; i++) {
    const t = i / PATH_SAMPLES;
    const girth = radius * endTaper(t);
    curve.getPoint(t, _point);
    if (offsetAt) _point.add(offsetAt(t, frames, i));
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

function updateRibbonGeometry(geometry, curve, width, thickness) {
  const frames = curve.computeFrenetFrames(RIBBON_SAMPLES, false);
  const positions = geometry.attributes.position.array;
  const normals = geometry.attributes.normal.array;
  const uvs = geometry.attributes.uv.array;

  for (let i = 0; i <= RIBBON_SAMPLES; i++) {
    const t = i / RIBBON_SAMPLES;
    const taper = endTaper(t);
    const halfW = (width * 0.5) * taper;
    const halfT = (thickness * 0.5) * taper;
    curve.getPoint(t, _point);
    _normal.copy(frames.normals[i]);
    _binormal.copy(frames.binormals[i]);
    const corners = [
      [-halfW, -halfT],
      [halfW, -halfT],
      [halfW, halfT],
      [-halfW, halfT],
    ];
    for (let c = 0; c < 4; c++) {
      const idx = (i * 4 + c) * 3;
      positions[idx] = _point.x + _binormal.x * corners[c][0] + _normal.x * corners[c][1];
      positions[idx + 1] = _point.y + _binormal.y * corners[c][0] + _normal.y * corners[c][1];
      positions[idx + 2] = _point.z + _binormal.z * corners[c][0] + _normal.z * corners[c][1];
      normals[idx] = _normal.x;
      normals[idx + 1] = _normal.y;
      normals[idx + 2] = _normal.z;
      const uv = (i * 4 + c) * 2;
      uvs[uv] = c < 2 ? 0 : 1;
      uvs[uv + 1] = t;
    }
  }

  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.normal.needsUpdate = true;
  geometry.attributes.uv.needsUpdate = true;
  geometry.computeBoundingSphere();
}

function placeSpheres(instanced, curve, radius, count, sizeScale, seed = 1) {
  const frames = curve.computeFrenetFrames(count - 1, false);
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const taper = endTaper(t);
    const size = radius * taper * sizeScale * (0.45 + 0.55 * hash01(seed, i, 1));
    curve.getPoint(t, _point);
    const jitter = radius * (0.35 + 0.55 * hash01(seed, i, 2)) * taper;
    _point.addScaledVector(frames.normals[i], (hash01(seed, i, 3) * 2 - 1) * jitter);
    _point.addScaledVector(frames.binormals[i], (hash01(seed, i, 4) * 2 - 1) * jitter);
    _scale.set(size, size, size);
    _quat.identity();
    _matrix.compose(_point, _quat, _scale);
    instanced.setMatrixAt(i, _matrix);
  }
  instanced.instanceMatrix.needsUpdate = true;
  instanced.computeBoundingSphere();
}

class StrokeCurve extends THREE.Curve {
  constructor(def) {
    super();
    this.def = def;
    this.aspect = 1;
  }

  getPoint(t, target = new THREE.Vector3()) {
    const from = this.def.from;
    const to = this.def.to;
    const point = [
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t,
    ];
    for (const wave of this.def.waves) {
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

function makeStrokeDefs() {
  const styles = ["tube", "ribbon", "helix", "twin", "cloud", "stars"];
  const extras = ["tube", "ribbon", "cloud", "stars"];
  const count = 5 + Math.floor(Math.random() * 3);
  const picked = shuffle(styles).slice(0, Math.min(count, styles.length));
  while (picked.length < count) picked.push(pick(extras));

  // Depth bands from near (camera) to far — shuffled so style↔depth changes.
  const depths = shuffle(
    Array.from({ length: picked.length }, (_, i) => {
      const t = picked.length === 1 ? 0.5 : i / (picked.length - 1);
      return lerp(2.15, -2.05, t) + rand(-0.12, 0.12);
    }),
  );
  const shades = shuffle(
    Array.from({ length: picked.length }, (_, i) => {
      const t = picked.length === 1 ? 0.55 : i / (picked.length - 1);
      return 0.1 + t * 0.82 + rand(-0.04, 0.04);
    }),
  );

  return shuffle(picked).map((style, i) => makeStrokeDef(style, depths[i], shades[i]));
}

function makeStrokeDef(style, depth, shade) {
  const ends = randomEndpoints(depth);
  const waves = randomWaves();
  const color = shadeColor(shade);
  const seed = Math.floor(Math.random() * 1e9);

  if (style === "ribbon") {
    return {
      style,
      color,
      seed,
      width: rand(0.14, 0.3),
      thickness: rand(0.008, 0.02),
      ...ends,
      waves,
    };
  }

  if (style === "helix") {
    return {
      style,
      color,
      seed,
      radius: rand(0.028, 0.048),
      spread: rand(0.08, 0.15),
      twists: rand(2.2, 4.4),
      ...ends,
      waves,
    };
  }

  if (style === "twin") {
    return {
      style,
      color,
      seed,
      radius: rand(0.03, 0.05),
      spread: rand(0.06, 0.13),
      ...ends,
      waves,
    };
  }

  if (style === "cloud") {
    return {
      style,
      color,
      seed,
      radius: rand(0.06, 0.11),
      count: 16 + Math.floor(Math.random() * 14),
      ...ends,
      waves,
    };
  }

  if (style === "stars") {
    return {
      style,
      color,
      seed,
      radius: rand(0.022, 0.04),
      count: 20 + Math.floor(Math.random() * 18),
      ...ends,
      waves,
    };
  }

  return {
    style: "tube",
    color,
    seed,
    radius: rand(0.055, 0.1),
    ...ends,
    waves,
  };
}

function randomEndpoints(depth) {
  const side = Math.random() < 0.5 ? 1 : -1;
  const fromX = side * rand(1.55, 2.55);
  const toX = -side * rand(1.55, 2.55);
  let fromY = rand(-2.35, 2.15);
  let toY = rand(-2.15, 2.45);
  if (Math.abs(toY - fromY) < 0.95) {
    toY = fromY + (Math.random() < 0.5 ? -1 : 1) * rand(1.05, 2.4);
  }
  // Flip orientation sometimes so strokes don't all read left→right.
  if (Math.random() < 0.5) {
    return {
      from: [toX, toY, depth + rand(-0.16, 0.16)],
      to: [fromX, fromY, depth + rand(-0.16, 0.16)],
    };
  }
  return {
    from: [fromX, fromY, depth + rand(-0.16, 0.16)],
    to: [toX, toY, depth + rand(-0.16, 0.16)],
  };
}

function randomWaves() {
  return [0, 1, 2].map((axis) => ({
    axis,
    freq: rand(0.32, 1.2),
    amp: axis === 2 ? rand(0.035, 0.11) : rand(0.08, 0.34),
    phase: rand(0, Math.PI * 2),
  }));
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function shuffle(list) {
  const next = list.slice();
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function hash01(seed, i, channel) {
  const n = Math.sin(seed * 0.0013 + i * 12.9898 + channel * 78.233) * 43758.5453;
  return n - Math.floor(n);
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
