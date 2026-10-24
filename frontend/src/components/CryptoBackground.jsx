import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./CryptoBackground.css";

/**
 * Professional crypto-themed animated background.
 *
 * Layers (back → front):
 *  1. CSS: deep navy gradient, soft glows, fading grid, vignette
 *  2. Canvas: slow-scrolling candlestick chart + price line + moving average
 *  3. Canvas: blockchain-style node network with travelling data pulses
 *  4. Canvas: faint drifting hash strings
 *
 * - Rendered through a portal into <body>, so it never affects page layout
 * - pointer-events: none → never blocks taps
 * - Capped at ~30fps, DPR capped at 2, paused when the tab is hidden
 * - Respects prefers-reduced-motion (draws one static frame)
 */

const CANDLE_W = 12;
const CANDLE_GAP = 7;
const STEP = CANDLE_W + CANDLE_GAP;
const SCROLL_SPEED = 7; // px / second

const HEX_CHARS = "0123456789abcdef";

const rand = (a, b) => a + Math.random() * (b - a);

const randomHash = () => {
  let s = "0x";
  for (let i = 0; i < 6; i += 1) s += HEX_CHARS[(Math.random() * 16) | 0];
  s += "…";
  for (let i = 0; i < 4; i += 1) s += HEX_CHARS[(Math.random() * 16) | 0];
  return s;
};

export default function CryptoBackground() {
  const canvasRef = useRef(null);

  // Let the page background show through while this component is mounted
  useEffect(() => {
    document.body.classList.add("crypto-bg-active");
    return () => document.body.classList.remove("crypto-bg-active");
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    let raf = 0;
    let last = 0;
    let offset = 0;
    let trend = 0;
    let trendLeft = 0;
    let pulseTimer = 0;
    let candles = [];
    let nodes = [];
    let pulses = [];
    let hashes = [];
    let linkDist = 120;

    /* ---------- generators ---------- */

    const nextCandle = (prevClose) => {
      if (trendLeft <= 0) {
        trend = rand(-0.03, 0.034);
        trendLeft = 5 + ((Math.random() * 8) | 0);
      }
      trendLeft -= 1;
      const vol = 0.05;
      const open = prevClose;
      let close =
        open + (Math.random() - 0.5) * 2 * vol + trend + (0.5 - open) * 0.025;
      close = Math.min(0.88, Math.max(0.12, close));
      return {
        o: open,
        c: close,
        h: Math.max(open, close) + Math.random() * vol * 0.8,
        l: Math.min(open, close) - Math.random() * vol * 0.8,
        v: 0.2 + Math.random() * 0.8,
      };
    };

    const buildCandles = () => {
      const n = Math.ceil(w / STEP) + 4;
      candles = [];
      let prev = 0.5;
      for (let i = 0; i < n; i += 1) {
        const c = nextCandle(prev);
        candles.push(c);
        prev = c.c;
      }
    };

    const buildNodes = () => {
      const count = Math.max(18, Math.min(42, Math.round((w * h) / 22000)));
      linkDist = w < 600 ? 105 : 140;
      nodes = Array.from({ length: count }, () => ({
        x: rand(0, w),
        y: rand(0, h),
        vx: rand(-9, 9),
        vy: rand(-9, 9),
        r: rand(1.2, 2.4),
        hex: Math.random() < 0.2,
        spin: rand(-0.0003, 0.0003),
        hexR: rand(6, 10),
      }));
      pulses = [];
    };

    const buildHashes = () => {
      const count = Math.max(4, Math.min(10, Math.round(w / 70)));
      hashes = Array.from({ length: count }, () => ({
        x: rand(8, Math.max(9, w - 90)),
        y: rand(0, h),
        v: rand(10, 22),
        text: randomHash(),
      }));
    };

    /* ---------- sizing ---------- */

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const prevW = w;
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (prevW !== w || candles.length === 0) {
        buildCandles();
        buildNodes();
        buildHashes();
      }
      if (reduceMotion) draw(0);
    };

    /* ---------- update ---------- */

    const update = (dt) => {
      // candles scroll
      offset += SCROLL_SPEED * dt;
      while (offset >= STEP) {
        offset -= STEP;
        candles.shift();
        candles.push(nextCandle(candles[candles.length - 1].c));
      }

      // nodes drift
      for (const n of nodes) {
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
      }

      // pulses
      pulseTimer -= dt;
      if (pulseTimer <= 0 && nodes.length > 1 && pulses.length < 6) {
        pulseTimer = rand(0.5, 1.4);
        const a = (Math.random() * nodes.length) | 0;
        const near = [];
        for (let b = 0; b < nodes.length; b += 1) {
          if (b === a) continue;
          const d = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
          if (d < linkDist) near.push(b);
        }
        if (near.length) {
          pulses.push({
            a,
            b: near[(Math.random() * near.length) | 0],
            p: 0,
          });
        }
      }
      pulses = pulses.filter((pl) => {
        pl.p += dt / 1.6;
        if (pl.p >= 1) return false;
        const A = nodes[pl.a];
        const B = nodes[pl.b];
        return Math.hypot(A.x - B.x, A.y - B.y) < linkDist * 1.25;
      });

      // hashes float upward
      for (const hs of hashes) {
        hs.y -= hs.v * dt;
        if (hs.y < -20) {
          hs.y = h + 20;
          hs.x = rand(8, Math.max(9, w - 90));
          hs.text = randomHash();
        }
      }
    };

    /* ---------- draw ---------- */

    const trace = (pts) => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i += 1) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      const l = pts[pts.length - 1];
      ctx.lineTo(l.x, l.y);
    };

    const drawChart = () => {
      const top = h * 0.4;
      const ch = h * 0.5;
      const bottom = top + ch;
      const Y = (p) => top + (1 - p) * ch;

      // horizontal price grid
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(56,189,248,.05)";
      ctx.beginPath();
      for (let k = 0; k <= 4; k += 1) {
        const y = Math.round(top + (ch * k) / 4) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();

      // candles + volume
      const closes = [];
      candles.forEach((cd, i) => {
        const x = i * STEP - offset + CANDLE_W / 2;
        const fade = Math.max(0, Math.min(1, Math.min(x, w - x) / (w * 0.14)));
        closes.push({ x, y: Y(cd.c) });
        if (fade <= 0) return;

        const up = cd.c >= cd.o;
        const col = up ? "34,211,238" : "129,140,248";
        ctx.globalAlpha = fade;

        const vh = cd.v * ch * 0.16;
        ctx.fillStyle = `rgba(${col},.07)`;
        ctx.fillRect(x - CANDLE_W / 2, bottom - vh, CANDLE_W, vh);

        ctx.strokeStyle = `rgba(${col},.30)`;
        ctx.beginPath();
        ctx.moveTo(x, Y(cd.h));
        ctx.lineTo(x, Y(cd.l));
        ctx.stroke();

        const yo = Y(cd.o);
        const yc = Y(cd.c);
        const by = Math.min(yo, yc);
        const bh = Math.max(2, Math.abs(yo - yc));
        ctx.fillStyle = `rgba(${col},${up ? 0.17 : 0.12})`;
        ctx.fillRect(x - CANDLE_W / 2, by, CANDLE_W, bh);
        ctx.strokeStyle = `rgba(${col},.38)`;
        ctx.strokeRect(x - CANDLE_W / 2 + 0.5, by + 0.5, CANDLE_W - 1, bh - 1);
      });
      ctx.globalAlpha = 1;

      if (closes.length < 4) return;

      // moving average (5)
      const ma = closes.map((_, i) => {
        const s = Math.max(0, i - 4);
        let sum = 0;
        for (let k = s; k <= i; k += 1) sum += closes[k].y;
        return { x: closes[i].x, y: sum / (i - s + 1) };
      });
      const gMa = ctx.createLinearGradient(0, 0, w, 0);
      gMa.addColorStop(0, "rgba(129,140,248,0)");
      gMa.addColorStop(0.2, "rgba(129,140,248,.4)");
      gMa.addColorStop(0.8, "rgba(129,140,248,.4)");
      gMa.addColorStop(1, "rgba(129,140,248,0)");
      ctx.strokeStyle = gMa;
      ctx.lineWidth = 1.2;
      trace(ma);
      ctx.stroke();

      // main price line + glow + area
      const gLine = ctx.createLinearGradient(0, 0, w, 0);
      gLine.addColorStop(0, "rgba(34,211,238,0)");
      gLine.addColorStop(0.18, "rgba(34,211,238,.6)");
      gLine.addColorStop(0.82, "rgba(34,211,238,.6)");
      gLine.addColorStop(1, "rgba(34,211,238,0)");
      ctx.strokeStyle = gLine;
      ctx.lineWidth = 1.8;
      ctx.shadowColor = "rgba(34,211,238,.55)";
      ctx.shadowBlur = 10;
      trace(closes);
      ctx.stroke();
      ctx.shadowBlur = 0;

      const gFill = ctx.createLinearGradient(0, top, 0, bottom);
      gFill.addColorStop(0, "rgba(34,211,238,.10)");
      gFill.addColorStop(1, "rgba(34,211,238,0)");
      ctx.fillStyle = gFill;
      ctx.lineTo(closes[closes.length - 1].x, bottom);
      ctx.lineTo(closes[0].x, bottom);
      ctx.closePath();
      ctx.fill();
    };

    const drawNetwork = (t) => {
      // links
      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const d2 = dx * dx + dy * dy;
          if (d2 < linkDist * linkDist) {
            const a = (1 - Math.sqrt(d2) / linkDist) * 0.18;
            ctx.strokeStyle = `rgba(125,211,252,${a.toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }

      // nodes (dots + hexagonal "blocks")
      for (const n of nodes) {
        if (n.hex) {
          ctx.strokeStyle = "rgba(125,211,252,.28)";
          ctx.fillStyle = "rgba(14,165,233,.06)";
          ctx.beginPath();
          for (let k = 0; k < 6; k += 1) {
            const ang = (Math.PI / 3) * k + t * n.spin;
            const px = n.x + Math.cos(ang) * n.hexR;
            const py = n.y + Math.sin(ang) * n.hexR;
            if (k === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillStyle = "rgba(186,230,253,.5)";
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // data pulses travelling along links
      ctx.shadowColor = "rgba(34,211,238,.9)";
      ctx.shadowBlur = 9;
      ctx.fillStyle = "rgba(165,243,252,.9)";
      for (const pl of pulses) {
        const A = nodes[pl.a];
        const B = nodes[pl.b];
        const x = A.x + (B.x - A.x) * pl.p;
        const y = A.y + (B.y - A.y) * pl.p;
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    };

    const drawHashes = () => {
      ctx.font =
        '10px ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace';
      ctx.fillStyle = "rgba(125,211,252,.08)";
      for (const hs of hashes) ctx.fillText(hs.text, hs.x, hs.y);
    };

    function draw(t) {
      ctx.clearRect(0, 0, w, h);
      drawHashes();
      drawChart();
      drawNetwork(t);
    }

    /* ---------- loop ---------- */

    const loop = (t) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 33) return; // ~30fps
      const dt = Math.min((t - last) / 1000, 0.1);
      last = t;
      update(dt);
      draw(t);
    };

    const start = () => {
      if (reduceMotion || raf) return;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    resize();
    if (reduceMotion) draw(0);
    else start();

    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return createPortal(
    <div className="crypto-bg" aria-hidden="true">
      <canvas ref={canvasRef} className="crypto-bg__canvas" />
    </div>,
    document.body
  );
}
