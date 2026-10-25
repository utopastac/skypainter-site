const year = document.getElementById("y");
if (year) year.textContent = String(new Date().getFullYear());

const worlds = document.getElementById("worlds");
if (worlds instanceof HTMLCanvasElement) startWorlds(worlds);

function startWorlds(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const light = normalize([6, 14, 8]);
  const shapes = [
    {
      polys: spherePolys(2),
      angle: -Math.PI / 2,
      spin: 0.55,
      axis: normalize([0.15, 1, 0.08]),
      offset: 0.6,
      scale: 0.92,
    },
    {
      polys: cubePolys(5),
      angle: 0.7,
      spin: 0.4,
      axis: normalize([0.35, 1, 0.2]),
      offset: 1.15,
      scale: 0.74,
    },
    {
      polys: pyramidPolys(),
      angle: Math.PI - 0.55,
      spin: 0.48,
      axis: normalize([0.1, 1, 0.25]),
      offset: 2.35,
      scale: 0.86,
    },
  ];

  let width = 1;
  let height = 1;
  let running = true;
  let ticking = false;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, Math.round(rect.width * dpr));
    height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function render(now) {
    const elapsed = reduce ? 0 : now / 1000;
    const orbit = elapsed * 0.28;
    const focal = Math.min(width * 0.78, height * 0.72);
    const camZ = 6.1;
    const orbitR = 2.05;
    const horizon = height * 0.5;

    ctx.clearRect(0, 0, width, height);

    const placed = shapes.map((shape) => {
      const spin = shape.offset + elapsed * shape.spin;
      const a = shape.angle + orbit;
      const pos = [Math.cos(a) * orbitR, -Math.sin(a) * 0.62, Math.sin(a) * orbitR * 0.55];
      return { shape, spin, pos };
    });

    placed
      .slice()
      .sort((a, b) => b.pos[2] - a.pos[2])
      .forEach(({ pos }) => {
        const ground = project([pos[0], -1.2, pos[2]], camZ, focal, horizon, width / 2);
        const scale = focal / Math.max(0.4, camZ - pos[2]);
        const rx = 0.78 * scale;
        const ry = rx * 0.28;
        const fade = Math.max(0.08, Math.min(0.28, 1.4 / (camZ - pos[2])));
        const g = ctx.createRadialGradient(ground[0], ground[1], rx * 0.05, ground[0], ground[1], rx);
        g.addColorStop(0, `rgba(62, 24, 22, ${fade})`);
        g.addColorStop(1, "rgba(62, 24, 22, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(ground[0], ground[1], rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      });

    const faces = [];
    for (const { shape, spin, pos } of placed) {
      for (const poly of shape.polys) {
        const n = rotateAround(poly.n, shape.axis, spin);
        const pts = poly.pts.map((p) => {
          const scaled = [p[0] * shape.scale, p[1] * shape.scale, p[2] * shape.scale];
          return add(rotateAround(scaled, shape.axis, spin), pos);
        });
        let depth = 0;
        const screen = pts.map((p) => {
          const s = project(p, camZ, focal, horizon, width / 2);
          depth += s[2];
          return s;
        });
        depth /= screen.length;
        faces.push({ screen, depth, n, albedo: poly.albedo });
      }
    }

    faces.sort((a, b) => b.depth - a.depth);
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1.4, width / 640);
    for (const face of faces) {
      const wrap = dot(face.n, light);
      const shade = wrap > 0.42 ? 1.08 : wrap > 0.1 ? 0.84 : wrap > -0.1 ? 0.62 : 0.44;
      const c = face.albedo.map((ch) => Math.max(0, Math.min(255, Math.round(ch * shade * 255))));
      ctx.beginPath();
      ctx.moveTo(face.screen[0][0], face.screen[0][1]);
      for (let i = 1; i < face.screen.length; i++) ctx.lineTo(face.screen[i][0], face.screen[i][1]);
      ctx.closePath();
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.fill();
      ctx.stroke();
    }
  }

  function loop(now) {
    ticking = false;
    render(now);
    if (running && !reduce) kick();
  }

  function kick() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(loop);
  }

  resize();
  kick();

  const resizeObserver = new ResizeObserver(() => {
    resize();
    if (reduce) render(0);
  });
  resizeObserver.observe(canvas.parentElement || canvas);

  const viewObserver = new IntersectionObserver(([entry]) => {
    running = entry.isIntersecting;
    if (running) kick();
  });
  viewObserver.observe(canvas);
}

function spherePolys(subdiv) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(normalize);
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  for (let s = 0; s < subdiv; s++) {
    const cache = new Map();
    const next = [];
    const mid = (i, j) => {
      const key = i < j ? `${i},${j}` : `${j},${i}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const idx = verts.length;
      verts.push(normalize(add(verts[i], verts[j])));
      cache.set(key, idx);
      return idx;
    };
    for (const [a, b, c] of faces) {
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }

  const incident = verts.map(() => []);
  const centroids = faces.map(([a, b, c]) => normalize(add(add(verts[a], verts[b]), verts[c])));
  faces.forEach((face, fi) => {
    for (const v of face) incident[v].push(fi);
  });

  return verts.map((center, vi) => {
    const frame = tangentFrame(center);
    const ids = incident[vi].slice().sort((i, j) => {
      return angleAround(centroids[i], center, frame) - angleAround(centroids[j], center, frame);
    });
    return makePoly(ids.map((i) => centroids[i]), center, 0.035);
  });
}

function cubePolys(n) {
  const s = 1;
  const quads = [
    [[s, -s, -s], [s, -s, s], [s, s, s], [s, s, -s]],
    [[-s, -s, s], [-s, -s, -s], [-s, s, -s], [-s, s, s]],
    [[-s, s, -s], [s, s, -s], [s, s, s], [-s, s, s]],
    [[-s, -s, s], [s, -s, s], [s, -s, -s], [-s, -s, -s]],
    [[-s, -s, s], [-s, s, s], [s, s, s], [s, -s, s]],
    [[s, -s, -s], [s, s, -s], [-s, s, -s], [-s, -s, -s]],
  ];
  return quads.flatMap((quad) => quadGrid(quad, n, 0.1));
}

function pyramidPolys() {
  const apex = [0, 1.2, 0];
  const y = -0.48;
  const w = 0.92;
  const base = [
    [w, y, w],
    [-w, y, w],
    [-w, y, -w],
    [w, y, -w],
  ];
  const sides = [];
  for (let i = 0; i < 4; i++) {
    sides.push(...subdivideTri(apex, base[i], base[(i + 1) % 4], 3));
  }
  return [...sides.map((pts) => makePoly(pts, null, 0.045)), ...quadGrid(base, 3, 0.045)];
}

function subdivideTri(a, b, c, n) {
  if (n === 0) return [[a, b, c]];
  const ab = mid(a, b);
  const bc = mid(b, c);
  const ca = mid(c, a);
  return [
    ...subdivideTri(a, ab, ca, n - 1),
    ...subdivideTri(ab, b, bc, n - 1),
    ...subdivideTri(ca, bc, c, n - 1),
    ...subdivideTri(ab, bc, ca, n - 1),
  ];
}

function quadGrid(corners, n, amp) {
  const [a, b, c, d] = corners;
  const at = (u, v) => {
    const w00 = (1 - u) * (1 - v);
    const w10 = u * (1 - v);
    const w11 = u * v;
    const w01 = (1 - u) * v;
    return [
      w00 * a[0] + w10 * b[0] + w11 * c[0] + w01 * d[0],
      w00 * a[1] + w10 * b[1] + w11 * c[1] + w01 * d[1],
      w00 * a[2] + w10 * b[2] + w11 * c[2] + w01 * d[2],
    ];
  };
  const polys = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u0 = i / n;
      const u1 = (i + 1) / n;
      const v0 = j / n;
      const v1 = (j + 1) / n;
      polys.push(makePoly([at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], null, amp));
    }
  }
  return polys;
}

function makePoly(pts, albedoAt, amp = 0.14) {
  const sculpted = pts.map((p) => {
    const n = normalize(p);
    const h =
      Math.sin(n[0] * 6.2 + 0.7) * Math.cos(n[1] * 5.4) * 0.55 +
      Math.sin(n[2] * 8.5 + n[0] * 2) * 0.35;
    return [p[0] + n[0] * h * amp, p[1] + n[1] * h * amp, p[2] + n[2] * h * amp];
  });
  const c = centroid(sculpted);
  let n = normalize(cross(sub(sculpted[1], sculpted[0]), sub(sculpted[2], sculpted[0])));
  if (dot(n, c) < 0) n = [-n[0], -n[1], -n[2]];
  return { pts: sculpted, n, albedo: albedoFor(albedoAt || c) };
}

function albedoFor(point) {
  const n = normalize(point);
  const blob = Math.sin(n[0] * 7.1 + n[2] * 2.4) * Math.cos(n[1] * 6.2 - n[0] * 1.7);
  const lift = blob > 0.12 ? 0.16 : blob < -0.22 ? -0.14 : 0;
  return [0.93 + lift, 0.92 + lift, 0.9 + lift];
}

function project(p, camZ, focal, horizon, originX) {
  const depth = Math.max(0.35, camZ - p[2]);
  const s = focal / depth;
  return [originX + p[0] * s, horizon - p[1] * s, depth];
}

function tangentFrame(n) {
  const up = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const t = normalize(cross(up, n));
  return { t, b: cross(n, t) };
}

function angleAround(p, n, frame) {
  const d = sub(p, n);
  return Math.atan2(dot(d, frame.b), dot(d, frame.t));
}

function rotateAround(v, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = dot(v, axis);
  const x = cross(axis, v);
  return [
    v[0] * c + x[0] * s + axis[0] * d * (1 - c),
    v[1] * c + x[1] * s + axis[1] * d * (1 - c),
    v[2] * c + x[2] * s + axis[2] * d * (1 - c),
  ];
}

function centroid(pts) {
  const s = pts.reduce((a, p) => add(a, p), [0, 0, 0]);
  return [s[0] / pts.length, s[1] / pts.length, s[2] / pts.length];
}

function mid(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}
