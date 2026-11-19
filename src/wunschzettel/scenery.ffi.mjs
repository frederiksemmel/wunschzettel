// Winter scenery behind the card for Weihnachten: falling snow in three depths and
// fir trees on snowy ground. The layers shift with the mouse (parallax); on phones
// the snow falls towards the real "down" from the accelerometer, tilting moves the
// layers and shaking whirls the snow up like a snow globe.
//
// It runs on its own and follows html[data-anlass], so the app only calls start().

const TAU = Math.PI * 2;

/** Snow layers, far to near. Density is flakes per pixel of screen area. */
const SNOW = [
  {
    depth: 0.15,
    density: 1 / 7000,
    size: [0.6, 1.3],
    speed: [14, 24],
    alpha: 0.35,
    crystal: false,
  },
  {
    depth: 0.45,
    density: 1 / 20000,
    size: [1.3, 2.3],
    speed: [26, 42],
    alpha: 0.6,
    crystal: false,
  },
  { depth: 1.0, density: 1 / 120000, size: [5, 8.5], speed: [42, 64], alpha: 0.75, crystal: true },
];
const MAX_SHIFT_X = 34; // px at depth 1
const MAX_SHIFT_Y = 16;

export function start() {
  if (typeof window === "undefined" || document.getElementById("scenery")) return;
  const canvas = document.createElement("canvas");
  canvas.id = "scenery";
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);
  new Scenery(canvas);
}

class Scenery {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.still = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.flakes = [];
    this.trees = { back: [], near: [], width: 0 };
    this.opacity = 0;
    this.on = false;
    this.running = false;
    this.last = 0;

    // Inputs, all smoothed in step()
    this.parallax = { x: 0, y: 0, tx: 0, ty: 0 };
    this.fall = { x: 0, y: 1, tx: 0, ty: 1 }; // direction snow falls in, screen space
    this.wind = 0;
    this.pointer = null; // {x, y} for pushing flakes aside
    this.motion = null; // accelerometer state once it reports

    this.resize();
    this.listen();
    this.follow();
  }

  // -- setup ------------------------------------------------------------------

  listen() {
    const observer = new MutationObserver(() => this.follow());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-anlass"],
    });
    window.addEventListener("resize", () => this.resize());
    document.addEventListener("visibilitychange", () => this.wake());
    this.still.addEventListener?.("change", () => this.wake());

    let lastMove = null;
    window.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.parallax.tx = (e.clientX / w) * 2 - 1;
      this.parallax.ty = (e.clientY / h) * 2 - 1;
      // A quick sweep of the mouse is a gust of wind
      if (lastMove) {
        const dt = Math.max(1, e.timeStamp - lastMove.t);
        this.wind += Math.max(-4, Math.min(4, (e.clientX - lastMove.x) / dt)) * 6;
      }
      lastMove = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      this.pointer = { x: e.clientX, y: e.clientY };
    });
    document.addEventListener("pointerleave", () => {
      this.pointer = null;
      this.parallax.tx = 0;
      this.parallax.ty = 0;
    });

    window.addEventListener("devicemotion", (e) => this.onMotion(e));
    // iOS reports motion only after the user agrees, and the question has to come from
    // a tap. Ask on the first tap that is not on a control, so it never gets in the way.
    const ask = globalThis.DeviceMotionEvent?.requestPermission;
    if (typeof ask === "function") {
      const onTap = (e) => {
        if (e.target.closest?.("a, button, input, textarea, select, label")) return;
        window.removeEventListener("pointerup", onTap);
        ask.call(DeviceMotionEvent).catch(() => {});
      };
      window.addEventListener("pointerup", onTap);
    }
  }

  /** Turn on for Weihnachten, fade out for everything else. */
  follow() {
    this.on = document.documentElement.dataset.anlass === "weihnachten";
    this.readColours();
    this.wake();
  }

  readColours() {
    const css = getComputedStyle(document.documentElement);
    const get = (name, fallback) =>
      parseHex(css.getPropertyValue(name).trim()) || parseHex(fallback);
    const bg = get("--bg", "#1F3B30");
    const deep = get("--bg-deep", "#172E25");
    const snow = get("--on-bg", "#E8E1CF");
    this.colours = {
      snow: rgb(snow),
      ground: rgb(mix(snow, bg, 0.42)),
      caps: rgb(mix(snow, deep, 0.25)),
      backTree: rgb(mix(bg, snow, 0.09)),
      nearTree: rgb(mix(deep, [0, 0, 0], 0.3)),
      star: rgb(get("--accent-light", "#C9A85E")),
      snowRGB: snow,
    };
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Phone toolbars change the height while scrolling; only a new width means new trees
    if (w !== this.trees.width) this.trees = plantTrees(w, h);
    this.populate();
    this.wake();
  }

  /** Keep the number of flakes in step with the screen area. */
  populate() {
    const area = this.w * this.h;
    const flakes = [];
    SNOW.forEach((layer, li) => {
      const wanted = Math.round(area * layer.density);
      const have = this.flakes.filter((f) => f.layer === li).slice(0, wanted);
      while (have.length < wanted) have.push(newFlake(li, this.w, this.h, true));
      flakes.push(...have);
    });
    this.flakes = flakes;
  }

  // -- loop -------------------------------------------------------------------

  wake() {
    if (this.still.matches || document.hidden) {
      // Reduced motion (or a hidden tab): one still frame, no loop
      this.opacity = this.on ? 1 : 0;
      this.draw();
      return;
    }
    if (this.running) return;
    if (!this.on && this.opacity === 0) {
      this.draw();
      return;
    }
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.step(dt);
    this.draw();
    if ((this.on || this.opacity > 0) && !document.hidden && !this.still.matches) {
      requestAnimationFrame((t) => this.frame(t));
    } else {
      this.running = false;
    }
  }

  step(dt) {
    this.opacity = approach(this.opacity, this.on ? 1 : 0, dt / 0.8);
    const ease = (tau) => 1 - Math.exp(-dt / tau);

    const p = this.parallax;
    p.x += (p.tx - p.x) * ease(0.35);
    p.y += (p.ty - p.y) * ease(0.35);

    // Without an accelerometer the snow leans a little towards the mouse side
    if (!this.motion) {
      const lean = p.x * 0.22;
      this.fall.tx = Math.sin(lean);
      this.fall.ty = Math.cos(lean);
    }
    const f = this.fall;
    f.x += (f.tx - f.x) * ease(0.3);
    f.y += (f.ty - f.y) * ease(0.3);
    this.wind *= Math.exp(-dt / 0.9);

    const { w, h } = this;
    const margin = 12;
    for (const flake of this.flakes) {
      const layer = SNOW[flake.layer];
      const drift = Math.sin(flake.phase) * flake.sway;
      flake.phase += dt * flake.swaySpeed;
      flake.spin += dt * flake.spinSpeed;

      // Flakes near the mouse get pushed aside, more so the nearer they are
      if (this.pointer && layer.depth > 0.3) {
        const sx = flake.x - p.x * MAX_SHIFT_X * layer.depth;
        const sy = flake.y - p.y * MAX_SHIFT_Y * layer.depth;
        const dx = sx - this.pointer.x;
        const dy = sy - this.pointer.y;
        const dist = Math.hypot(dx, dy);
        const reach = 90 + 60 * layer.depth;
        if (dist > 0.1 && dist < reach) {
          const push = (1 - dist / reach) * 900 * layer.depth * dt;
          flake.vx += (dx / dist) * push;
          flake.vy += (dy / dist) * push;
        }
      }

      const speed = flake.speed;
      flake.x += (f.x * speed + flake.vx + this.wind * (0.4 + layer.depth) + drift * f.y) * dt;
      flake.y += (f.y * speed + flake.vy - drift * f.x) * dt;
      const damp = Math.exp(-dt * 1.6);
      flake.vx *= damp;
      flake.vy *= damp;

      // Wrap around all edges: on a phone held upside down the snow falls "up"
      if (flake.y > h + margin) flake.y -= h + 2 * margin;
      else if (flake.y < -margin) flake.y += h + 2 * margin;
      if (flake.x > w + margin) flake.x -= w + 2 * margin;
      else if (flake.x < -margin) flake.x += w + 2 * margin;
    }
  }

  // -- phone motion -----------------------------------------------------------

  onMotion(e) {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null || g.y == null) return;
    // Device axes to screen axes (x right, y down) for the current rotation.
    // At rest the sensor reports the push against gravity, so gravity is the negative.
    const angle = screen.orientation?.angle ?? window.orientation ?? 0;
    let gx;
    let gy;
    switch (((angle % 360) + 360) % 360) {
      case 90:
        gx = g.y;
        gy = g.x;
        break;
      case 180:
        gx = g.x;
        gy = -g.y;
        break;
      case 270:
        gx = -g.y;
        gy = -g.x;
        break;
      default:
        gx = -g.x;
        gy = g.y;
    }

    const now = e.timeStamp || performance.now();
    if (!this.motion) {
      this.motion = { sign: 1, votes: 0, gx, gy, slowX: gx, slowY: gy, t: now, lastGust: 0 };
    }
    const m = this.motion;
    const dt = Math.min(0.2, Math.max(0.001, (now - m.t) / 1000));
    m.t = now;

    // Some browsers report the opposite sign. A phone being read is held roughly
    // upright, so gravity should point to the bottom of the screen: let it vote.
    if (Math.abs(gy) > 4 && m.votes < 40) {
      m.votes++;
      m.sign = Math.sign(gy) || 1;
    }
    gx *= m.sign;
    gy *= m.sign;

    const fast = 1 - Math.exp(-dt / 0.12);
    const slow = 1 - Math.exp(-dt / 2.5);
    const shakeX = gx - m.gx;
    const shakeY = gy - m.gy;
    m.gx += (gx - m.gx) * fast;
    m.gy += (gy - m.gy) * fast;
    m.slowX += (m.gx - m.slowX) * slow;
    m.slowY += (m.gy - m.slowY) * slow;

    // Snow falls along gravity; lying flat it settles into a slow drift downwards
    const len = Math.hypot(m.gx, m.gy);
    const dirX = m.gx / 9.81;
    const dirY = m.gy / 9.81 + (len < 3 ? 0.35 : 0);
    const n = Math.hypot(dirX, dirY) || 1;
    const strength = Math.max(0.35, Math.min(1, len / 9.81));
    this.fall.tx = (dirX / n) * strength;
    this.fall.ty = (dirY / n) * strength;

    // Tilting away from how the phone is usually held moves the layers
    this.parallax.tx = clamp((m.gx - m.slowX) / 3.5, -1, 1);
    this.parallax.ty = clamp((m.gy - m.slowY) / 3.5, -1, 1);

    // A shake throws the snow against the motion, like a snow globe
    const jolt = Math.hypot(shakeX, shakeY);
    if (jolt > 7 && now - m.lastGust > 120) {
      m.lastGust = now;
      const power = Math.min(jolt - 7, 25);
      for (const flake of this.flakes) {
        const depth = SNOW[flake.layer].depth;
        const k = power * (14 + 22 * depth);
        flake.vx += (-shakeX / jolt) * k + (Math.random() - 0.5) * k * 1.4;
        flake.vy += (-shakeY / jolt) * k + (Math.random() - 0.5) * k * 1.4;
      }
      this.wake();
    }
  }

  // -- drawing ----------------------------------------------------------------

  draw() {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    if (this.opacity <= 0) return;
    ctx.globalAlpha = this.opacity;
    const c = this.colours;
    const shift = (depth) => [
      -this.parallax.x * MAX_SHIFT_X * depth,
      -this.parallax.y * MAX_SHIFT_Y * depth,
    ];

    this.drawSnow(0, shift);
    const [bx, by] = shift(0.3);
    for (const t of this.trees.back) drawTree(ctx, t, bx, h + by, c.backTree, null, null);
    this.drawSnow(1, shift);

    const [gx, gy] = shift(0.55);
    drawGround(ctx, this.trees.ground, w, h, gx, gy, c.ground);
    const [nx, ny] = shift(0.8);
    for (const t of this.trees.near)
      drawTree(ctx, t, nx, h + ny, c.nearTree, c.caps, t.star ? c.star : null);
    this.drawSnow(2, shift);
    ctx.globalAlpha = 1;
  }

  drawSnow(li, shift) {
    const { ctx } = this;
    const layer = SNOW[li];
    const [ox, oy] = shift(layer.depth);
    const [r, g, b] = this.colours.snowRGB;
    ctx.fillStyle = `rgba(${r},${g},${b},${layer.alpha})`;
    ctx.strokeStyle = ctx.fillStyle;
    if (!layer.crystal) {
      ctx.beginPath();
      for (const f of this.flakes) {
        if (f.layer !== li) continue;
        ctx.moveTo(f.x + ox + f.size, f.y + oy);
        ctx.arc(f.x + ox, f.y + oy, f.size, 0, TAU);
      }
      ctx.fill();
      return;
    }
    ctx.lineWidth = 1.1;
    ctx.lineCap = "round";
    for (const f of this.flakes) {
      if (f.layer !== li) continue;
      drawCrystal(ctx, f.x + ox, f.y + oy, f.size, f.spin);
    }
  }
}

// -- shapes -------------------------------------------------------------------

function newFlake(layer, w, h, anywhere) {
  const l = SNOW[layer];
  return {
    layer,
    x: Math.random() * w,
    y: anywhere ? Math.random() * h : -10,
    vx: 0,
    vy: 0,
    size: between(l.size),
    speed: between(l.speed),
    phase: Math.random() * TAU,
    sway: 4 + Math.random() * 10 * (0.5 + l.depth),
    swaySpeed: 0.6 + Math.random() * 0.9,
    spin: Math.random() * TAU,
    spinSpeed: (Math.random() - 0.5) * 0.8,
  };
}

/** A six-armed snow crystal with a pair of side branches on each arm. */
function drawCrystal(ctx, x, y, size, spin) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = spin + (i * TAU) / 6;
    const ax = Math.cos(a);
    const ay = Math.sin(a);
    ctx.moveTo(x, y);
    ctx.lineTo(x + ax * size, y + ay * size);
    const bx = x + ax * size * 0.55;
    const by = y + ay * size * 0.55;
    for (const side of [-1, 1]) {
      const b = a + side * 0.75;
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(b) * size * 0.32, by + Math.sin(b) * size * 0.32);
    }
  }
  ctx.stroke();
}

/** Trees at fixed positions for a screen width; a seeded random keeps them steady. */
function plantTrees(w, h) {
  const rand = seeded(7);
  const scale = Math.min(1, Math.max(0.6, w / 1200));
  const groundH = clamp(h * 0.04, 20, 44);

  const back = [];
  for (let x = -20; x < w + 40; x += (38 + rand() * 34) * scale) {
    const height = (70 + rand() * 80) * scale;
    back.push({
      x,
      base: groundH * 0.55 + rand() * 6,
      height,
      width: height * (0.5 + rand() * 0.12),
      tiers: 4,
    });
  }

  const near = [];
  const cluster = (from, to, count) => {
    for (let i = 0; i < count; i++) {
      const height = (150 + rand() * 140) * scale;
      near.push({
        x: from + ((to - from) * (i + rand() * 0.6)) / count,
        base: groundH * (0.25 + rand() * 0.35),
        height,
        width: height * (0.48 + rand() * 0.1),
        tiers: 5,
        star: false,
      });
    }
  };
  const side = Math.max(130, w * 0.16);
  cluster(-side * 0.25, side, w < 600 ? 2 : 3);
  cluster(w - side, w + side * 0.25, w < 600 ? 2 : 3);
  // The tallest tree carries the star from the ornament
  near.reduce((a, b) => (b.height > a.height ? b : a)).star = true;

  const ground = [];
  for (let i = 0; i < 4; i++)
    ground.push({ f: 0.002 + rand() * 0.006, p: rand() * TAU, a: 3 + rand() * 7 });
  return { back, near, width: w, ground: { waves: ground, height: groundH } };
}

/** A fir: stacked tiers with drooping edges, snow resting on each tier. */
function drawTree(ctx, t, ox, bottom, fill, snow, star) {
  const x = t.x + ox;
  const base = bottom - t.base;
  const top = base - t.height;
  const trunkH = t.height * 0.08;
  ctx.fillStyle = fill;
  ctx.fillRect(x - t.width * 0.05, base - trunkH, t.width * 0.1, trunkH + t.base + 4);

  const tierH = (t.height - trunkH) / (t.tiers * 0.72 + 0.28);
  for (let i = 0; i < t.tiers; i++) {
    const y1 = base - trunkH - i * tierH * 0.72; // bottom edge of this tier
    const y0 = y1 - tierH; // its tip
    const half = (t.width / 2) * (1 - i / (t.tiers + 0.6));
    ctx.beginPath();
    ctx.moveTo(x, Math.max(y0, top));
    ctx.quadraticCurveTo(x + half * 0.45, y1 - tierH * 0.35, x + half, y1);
    ctx.quadraticCurveTo(x + half * 0.5, y1 - tierH * 0.12, x, y1 - tierH * 0.06);
    ctx.quadraticCurveTo(x - half * 0.5, y1 - tierH * 0.12, x - half, y1);
    ctx.quadraticCurveTo(x - half * 0.45, y1 - tierH * 0.35, x, Math.max(y0, top));
    ctx.fillStyle = fill;
    ctx.fill();
    if (snow) {
      // a thin cap of snow along the upper slopes
      ctx.beginPath();
      ctx.moveTo(x, Math.max(y0, top));
      ctx.quadraticCurveTo(x + half * 0.25, y0 + tierH * 0.24, x + half * 0.42, y0 + tierH * 0.48);
      ctx.quadraticCurveTo(x + half * 0.16, y0 + tierH * 0.34, x, y0 + tierH * 0.3);
      ctx.quadraticCurveTo(x - half * 0.16, y0 + tierH * 0.34, x - half * 0.42, y0 + tierH * 0.48);
      ctx.quadraticCurveTo(x - half * 0.25, y0 + tierH * 0.24, x, Math.max(y0, top));
      ctx.fillStyle = snow;
      ctx.globalAlpha *= 0.7;
      ctx.fill();
      ctx.globalAlpha /= 0.7;
    }
  }
  if (star) {
    // Same four-pointed star as the ornament rule, scaled to the tree
    const s = Math.max(7, t.height * 0.045);
    const cx = x;
    const cy = top - s * 0.15;
    ctx.beginPath();
    ctx.moveTo(cx, cy - s);
    ctx.lineTo(cx + s * 0.23, cy - s * 0.23);
    ctx.lineTo(cx + s, cy);
    ctx.lineTo(cx + s * 0.23, cy + s * 0.23);
    ctx.lineTo(cx, cy + s);
    ctx.lineTo(cx - s * 0.23, cy + s * 0.23);
    ctx.lineTo(cx - s, cy);
    ctx.lineTo(cx - s * 0.23, cy - s * 0.23);
    ctx.closePath();
    ctx.fillStyle = star;
    ctx.fill();
  }
}

/** Snowy ground: a soft, slightly wavy band along the bottom. */
function drawGround(ctx, ground, w, h, ox, oy, fill) {
  const { waves, height } = ground;
  ctx.beginPath();
  ctx.moveTo(-60, h + 10);
  for (let x = -60; x <= w + 60; x += 12) {
    let y = h - height + oy;
    for (const wv of waves) y += Math.sin((x - ox) * wv.f + wv.p) * wv.a;
    ctx.lineTo(x + ox, y);
  }
  ctx.lineTo(w + 60 + ox, h + 10);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.globalAlpha *= 0.92;
  ctx.fill();
  ctx.globalAlpha /= 0.92;
}

// -- small helpers --------------------------------------------------------------

function between([a, b]) {
  return a + Math.random() * (b - a);
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function approach(v, target, step) {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function parseHex(s) {
  const m = /^#?([0-9a-f]{6})$/i.exec(s || "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}
function rgb([r, g, b]) {
  return `rgb(${r},${g},${b})`;
}
