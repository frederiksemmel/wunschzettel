// Winter scenery behind the card for Weihnachten: falling snow in three depths and
// fir trees on snowy ground. The snow plays along: the mouse shifts the layers
// (parallax) and pushes flakes aside, a tap blows them away, a finger sweeps them
// along, and scrolling is wind that carries and swirls them.
//
// Built to stay smooth and cheap at 60 fps: the trees and the ground are drawn once
// into strips that only move by CSS transform, the crystals in front of the card are
// small pre-drawn images moved the same way, and only the falling dots are redrawn
// each frame, at 1x resolution. Moving finished layers is the compositor's job and
// costs next to nothing.
//
// It runs on its own and follows html[data-anlass], so the app only calls start().

const TAU = Math.PI * 2;

/** Snow layers, far to near. Density is flakes per pixel of screen area; the near
 * crystals are counted per screen and drawn in front of the card, so the snow you
 * touch and scroll is visible even on a phone, where the card fills the width. */
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
  {
    depth: 1.0,
    count: (area) => clamp(Math.round(area / 60000), 6, 16),
    size: [5, 8.5],
    speed: [42, 64],
    alpha: 0.8,
    crystal: true,
  },
];
const MAX_SHIFT_X = 34; // px at depth 1
const MAX_SHIFT_Y = 16;
// Strips reach this far past the screen edges, so the parallax never shows a gap
const PAD = 48;

/** The tree and ground strips, back to front, with their parallax depth. */
const STRIPS = [
  { name: "back", depth: 0.3 },
  { name: "ground", depth: 0.55 },
  { name: "near", depth: 0.8 },
];

export function start() {
  if (typeof window === "undefined" || document.getElementById("scenery")) return;
  const scenery = new Scenery();
  // Reachable from the console and browser tests as document.getElementById("scenery").scenery
  scenery.back.scenery = scenery;
}

function layer(id) {
  const el = document.createElement("div");
  el.id = id;
  el.setAttribute("aria-hidden", "true");
  return el;
}

function placed(el, css) {
  Object.assign(el.style, { position: "absolute", left: "0", top: "0", ...css });
  return el;
}

class Scenery {
  constructor() {
    // Behind the page: the falling dots, then the tree and ground strips
    this.back = layer("scenery");
    this.dots = placed(document.createElement("canvas"), { width: "100%", height: "100%" });
    this.ctx = this.dots.getContext("2d");
    this.back.append(this.dots);
    this.strips = STRIPS.map((strip) => {
      const canvas = placed(document.createElement("canvas"), {
        top: "auto",
        bottom: `-${PAD}px`,
        left: `-${PAD}px`,
        willChange: "transform",
      });
      this.back.append(canvas);
      return { ...strip, canvas, shift: "" };
    });
    // In front of the page: the crystals
    this.front = layer("scenery-front");
    document.body.prepend(this.back);
    document.body.append(this.front);

    this.still = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.flakes = [];
    this.trees = { width: 0 };
    this.colourKey = "";
    this.opacity = -1; // forces the first render to set it
    this.shownOpacity = null;
    this.on = false;
    this.running = false;
    this.last = 0;

    // Inputs, all smoothed or decayed in step()
    this.parallax = { x: 0, y: 0, tx: 0, ty: 0 };
    this.fall = { x: 0, y: 1 }; // direction snow falls in, screen space
    this.wind = 0; // sideways gust from a quick mouse sweep, px/s
    this.lift = 0; // vertical gust from scrolling, px/s
    this.stir = 0; // 0..1, how much scrolling swirls the flakes
    this.pointer = null; // mouse {x, y}
    this.touch = null; // finger {x, y, vx, vy, t}

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
      this.parallax.tx = (e.clientX / this.w) * 2 - 1;
      this.parallax.ty = (e.clientY / this.h) * 2 - 1;
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

    // Touch: a tap blows the flakes away, a moving finger sweeps them along
    const finger = (e) => e.touches[0] || e.changedTouches[0];
    const opts = { passive: true };
    window.addEventListener(
      "touchstart",
      (e) => {
        const t = finger(e);
        this.touch = { x: t.clientX, y: t.clientY, vx: 0, vy: 0, t: e.timeStamp };
        this.blow(t.clientX, t.clientY);
      },
      opts,
    );
    window.addEventListener(
      "touchmove",
      (e) => {
        const t = finger(e);
        const touch = this.touch;
        if (!touch) return;
        const dt = Math.max(8, e.timeStamp - touch.t) / 1000;
        touch.vx += ((t.clientX - touch.x) / dt - touch.vx) * 0.5;
        touch.vy += ((t.clientY - touch.y) / dt - touch.vy) * 0.5;
        touch.x = t.clientX;
        touch.y = t.clientY;
        touch.t = e.timeStamp;
      },
      opts,
    );
    const lift = () => {
      this.touch = null;
    };
    window.addEventListener("touchend", lift, opts);
    window.addEventListener("touchcancel", lift, opts);

    // Scrolling is wind: the snow is carried along with the page and swirls
    let lastScroll = { y: window.scrollY, t: performance.now() };
    window.addEventListener(
      "scroll",
      () => {
        const now = performance.now();
        const dt = Math.max(8, now - lastScroll.t) / 1000;
        const v = clamp((window.scrollY - lastScroll.y) / dt, -4000, 4000);
        lastScroll = { y: window.scrollY, t: now };
        this.lift = clamp(this.lift - v * 0.35, -700, 700);
        this.stir = Math.max(this.stir, Math.min(1, Math.abs(v) / 1500));
      },
      opts,
    );
  }

  /** A puff from a tap: flakes nearby fly outwards, the near ones furthest. */
  blow(x, y) {
    const reach = Math.max(160, Math.min(this.w, this.h) * 0.6);
    for (const flake of this.flakes) {
      const depth = SNOW[flake.layer].depth;
      const [sx, sy] = this.onScreen(flake);
      const dx = sx - x;
      const dy = sy - y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.1 || dist > reach) continue;
      const k = (1 - dist / reach) * 420 * (0.4 + depth);
      flake.vx += (dx / dist) * k;
      flake.vy += (dy / dist) * k;
    }
  }

  /** Where a flake is drawn, parallax included. */
  onScreen(flake) {
    const depth = SNOW[flake.layer].depth;
    return [
      flake.x - this.parallax.x * MAX_SHIFT_X * depth,
      flake.y - this.parallax.y * MAX_SHIFT_Y * depth,
    ];
  }

  /** Turn on for Weihnachten, fade out for everything else. */
  follow() {
    this.on = document.documentElement.dataset.anlass === "weihnachten";
    this.readColours();
    const key = JSON.stringify(this.colours);
    if (key !== this.colourKey) {
      this.colourKey = key;
      this.paintStrips();
      for (const f of this.flakes) if (f.sprite) paintCrystal(f, this.colours, this.dpr);
    }
    if (this.opacity < 0) this.opacity = 0;
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
    // The layers are 100vh tall: on phones that is the full screen height, which stays
    // put while the browser's toolbar shrinks and grows during scrolling. Sizing by the
    // window instead made the whole scene jump with the toolbar.
    const w = this.back.clientWidth || window.innerWidth;
    const h = this.back.clientHeight || window.innerHeight;
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Soft dots look the same at 1x and cost a quarter of the pixels on a phone
    this.dots.width = w;
    this.dots.height = h;
    // Phone toolbars change the height while scrolling; only a new width means new trees
    if (w !== this.trees.width) {
      this.trees = plantTrees(w, h);
      this.paintStrips();
    }
    this.populate();
    this.wake();
  }

  /** Draw the trees and the ground once; afterwards they only move. */
  paintStrips() {
    const { colours: c, trees, w, dpr } = this;
    if (!c || !trees.width) return;
    const tallest = Math.max(
      ...[...trees.back, ...trees.near].map((t) => t.base + t.height * 1.12),
    );
    const height = Math.ceil(tallest + 24) + PAD;
    const bottom = height - PAD; // the bottom edge of the screen, inside the strip
    for (const strip of this.strips) {
      const { canvas } = strip;
      canvas.width = Math.round((w + 2 * PAD) * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${w + 2 * PAD}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w + 2 * PAD, height);
      if (strip.name === "back") {
        for (const t of trees.back) drawTree(ctx, t, PAD, bottom, c.backTree, null, null);
      } else if (strip.name === "ground") {
        drawGround(ctx, trees.ground, w, bottom, PAD, 0, c.ground, PAD + 10);
      } else {
        for (const t of trees.near) {
          drawTree(ctx, t, PAD, bottom, c.nearTree, c.caps, t.star ? c.star : null);
        }
      }
    }
  }

  /** Keep the number of flakes in step with the screen area. */
  populate() {
    const area = this.w * this.h;
    const flakes = [];
    SNOW.forEach((layer, li) => {
      // Small screens get a little more snow; the card covers most of them
      const boost = this.w < 700 ? 1.6 : 1;
      const wanted = layer.count ? layer.count(area) : Math.round(area * layer.density * boost);
      const have = this.flakes.filter((f) => f.layer === li);
      for (const gone of have.splice(wanted)) gone.sprite?.remove();
      while (have.length < wanted) {
        const flake = newFlake(li, this.w, this.h, true);
        if (layer.crystal) {
          flake.sprite = placed(document.createElement("canvas"), {
            willChange: "transform",
            opacity: String(layer.alpha),
          });
          if (this.colours) paintCrystal(flake, this.colours, this.dpr);
          this.front.append(flake.sprite);
        }
        have.push(flake);
      }
      flakes.push(...have);
    });
    this.flakes = flakes;
  }

  // -- loop -------------------------------------------------------------------

  wake() {
    if (this.still.matches || document.hidden) {
      // Reduced motion (or a hidden tab): one still frame, no loop
      this.opacity = this.on ? 1 : 0;
      this.render();
      return;
    }
    if (this.running) return;
    if (!this.on && this.opacity <= 0) {
      this.render();
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
    this.render();
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

    // The snow leans a little towards the side the mouse is on
    const lean = p.x * 0.22;
    const f = this.fall;
    f.x += (Math.sin(lean) - f.x) * ease(0.3);
    f.y += (Math.cos(lean) - f.y) * ease(0.3);
    this.wind *= Math.exp(-dt / 0.9);
    this.lift *= Math.exp(-dt / 0.5);
    this.stir *= Math.exp(-dt / 0.7);
    const touch = this.touch;
    if (touch) {
      touch.vx *= Math.exp(-dt / 0.12);
      touch.vy *= Math.exp(-dt / 0.12);
    }

    const { w, h } = this;
    const margin = 20;
    for (const flake of this.flakes) {
      const layer = SNOW[flake.layer];
      const drift = Math.sin(flake.phase) * flake.sway;
      flake.phase += dt * flake.swaySpeed;
      flake.spin += dt * flake.spinSpeed;

      // Flakes near the mouse get pushed aside, more so the nearer they are
      if (this.pointer && layer.depth > 0.3) {
        const [sx, sy] = this.onScreen(flake);
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

      // A finger pushes flakes aside and drags them along the way it moves
      if (touch) {
        const [sx, sy] = this.onScreen(flake);
        const dx = sx - touch.x;
        const dy = sy - touch.y;
        const dist = Math.hypot(dx, dy);
        const reach = 110 + 70 * layer.depth;
        if (dist > 0.1 && dist < reach) {
          const near = 1 - dist / reach;
          const grip = Math.min(1, near * 7 * dt);
          flake.vx += (touch.vx - flake.vx) * grip + (dx / dist) * near * 500 * dt;
          flake.vy += (touch.vy - flake.vy) * grip + (dy / dist) * near * 500 * dt;
        }
      }

      // Scrolling swirls each flake its own way
      if (this.stir > 0.01) {
        const swirl = this.stir * 700 * (0.3 + layer.depth) * dt;
        flake.vx += Math.sin(flake.phase * 2.3 + flake.spin) * swirl;
        flake.vy += Math.cos(flake.phase * 1.7) * swirl * 0.4;
      }

      const speed = flake.speed;
      flake.x += (f.x * speed + flake.vx + this.wind * (0.4 + layer.depth) + drift * f.y) * dt;
      flake.y +=
        (f.y * speed + flake.vy + this.lift * (0.35 + 0.65 * layer.depth) - drift * f.x) * dt;
      const damp = Math.exp(-dt * 1.6);
      flake.vx *= damp;
      flake.vy *= damp;

      // Wrap around all edges: wind and fingers can carry flakes out of any side
      if (flake.y > h + margin) flake.y -= h + 2 * margin;
      else if (flake.y < -margin) flake.y += h + 2 * margin;
      if (flake.x > w + margin) flake.x -= w + 2 * margin;
      else if (flake.x < -margin) flake.x += w + 2 * margin;
    }
  }

  // -- drawing ----------------------------------------------------------------

  render() {
    // Fading is the compositor's job too: one opacity per layer
    const opacity = Math.max(0, this.opacity);
    if (opacity !== this.shownOpacity) {
      this.shownOpacity = opacity;
      for (const el of [this.back, this.front]) {
        el.style.opacity = String(opacity);
        el.style.visibility = opacity > 0 ? "visible" : "hidden";
      }
    }
    if (opacity <= 0) return;

    const { ctx, w, h, parallax: p } = this;
    ctx.clearRect(0, 0, w, h);
    // All dots of a layer in one path, filled once
    const [r, g, b] = this.colours.snowRGB;
    for (const li of [0, 1]) {
      const layer = SNOW[li];
      const ox = -p.x * MAX_SHIFT_X * layer.depth;
      const oy = -p.y * MAX_SHIFT_Y * layer.depth;
      ctx.fillStyle = `rgba(${r},${g},${b},${layer.alpha})`;
      ctx.beginPath();
      for (const f of this.flakes) {
        if (f.layer !== li) continue;
        ctx.moveTo(f.x + ox + f.size, f.y + oy);
        ctx.arc(f.x + ox, f.y + oy, f.size, 0, TAU);
      }
      ctx.fill();
    }

    for (const strip of this.strips) {
      const tx = (-p.x * MAX_SHIFT_X * strip.depth).toFixed(1);
      const ty = (-p.y * MAX_SHIFT_Y * strip.depth).toFixed(1);
      const shift = `translate3d(${tx}px,${ty}px,0)`;
      if (shift !== strip.shift) {
        strip.shift = shift;
        strip.canvas.style.transform = shift;
      }
    }

    for (const f of this.flakes) {
      if (!f.sprite) continue;
      const [x, y] = this.onScreen(f);
      const half = f.box / 2;
      f.sprite.style.transform = `translate3d(${(x - half).toFixed(1)}px,${(y - half).toFixed(1)}px,0) rotate(${f.spin.toFixed(3)}rad)`;
    }
  }
}

/** Pre-draw a crystal with a faint dark halo, so it reads on the paper as well. */
function paintCrystal(flake, colours, dpr) {
  const box = Math.ceil(flake.size * 2 + 10);
  const canvas = flake.sprite;
  flake.box = box;
  canvas.width = Math.round(box * dpr);
  canvas.height = Math.round(box * dpr);
  canvas.style.width = `${box}px`;
  canvas.style.height = `${box}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, box, box);
  ctx.strokeStyle = colours.snow;
  ctx.lineWidth = 1.3;
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(15, 30, 24, 0.45)";
  ctx.shadowBlur = 2.5;
  drawCrystal(ctx, box / 2, box / 2, flake.size, 0);
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
function drawGround(ctx, ground, w, h, ox, oy, fill, below = 10) {
  const { waves, height } = ground;
  ctx.beginPath();
  ctx.moveTo(-60, h + below);
  for (let x = -60; x <= w + 60; x += 12) {
    let y = h - height + oy;
    for (const wv of waves) y += Math.sin((x - ox) * wv.f + wv.p) * wv.a;
    ctx.lineTo(x + ox, y);
  }
  ctx.lineTo(w + 60 + ox, h + below);
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
