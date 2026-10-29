/**
 * Minimal canvas plotting for the tool: axes with "nice" ticks, lines, points
 * with error bars, and a hook for custom drawing (the catapult sketch).
 *
 * Written in-house instead of using uPlot/Plotly so the app has no external
 * dependencies and works fully offline. Colours come from CSS custom
 * properties, so the plots follow the page's light/dark theme.
 */
(function (root, factory) {
  "use strict";
  root.MiniPlot = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Tick values covering [lo, hi] with roughly `count` steps of 1, 2 or 5 x 10^n. */
  function niceTicks(lo, hi, count) {
    const span = hi - lo;
    if (!(span > 0)) return [lo];
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((f) => f * mag).find((s) => s >= raw);
    const ticks = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) {
      ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    }
    return ticks;
  }

  function formatTick(v) {
    return String(Math.round(v * 1000) / 1000);
  }

  function cssVar(el, name, fallback) {
    const v = getComputedStyle(el).getPropertyValue(name).trim();
    return v || fallback;
  }

  class MiniPlot {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {{xLabel: string, yLabel: string}} labels
     */
    constructor(canvas, labels) {
      this.canvas = canvas;
      this.labels = labels;
      this.margin = { left: 52, right: 14, top: 12, bottom: 40 };
      this.spec = null;
      this.onClick = null;
      if (typeof ResizeObserver !== "undefined") {
        new ResizeObserver(() => this.spec && this.draw(this.spec)).observe(canvas);
      }
      canvas.addEventListener("click", (ev) => {
        if (!this.onClick || !this.spec) return;
        const rect = canvas.getBoundingClientRect();
        const x = this.fromPx(ev.clientX - rect.left);
        if (x >= this.spec.x[0] && x <= this.spec.x[1]) this.onClick(x);
      });
    }

    toPx(x, y) {
      return [this.ox + (x - this.spec.x[0]) * this.sx, this.oy - (y - this.spec.y[0]) * this.sy];
    }

    fromPx(px) {
      return this.spec.x[0] + (px - this.ox) / this.sx;
    }

    /**
     * Draw a plot.
     * @param {object} spec
     *   x, y: [min, max] data ranges; equalAspect: keep 1 m = 1 m on both axes
     *   (both ranges are then extended so that each requested range fits);
     *   series: [{type: "line"|"points", points, color, width, dash, label}];
     *     line points are [x, y]; points are {x, y, lo, hi, faded};
     *   decorate(ctx, toPx, scale): optional extra drawing in data coordinates.
     */
    draw(spec) {
      this.spec = spec;
      const c = this.canvas;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (!w || !h) return;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      const ctx = c.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const m = this.margin;
      const pw = w - m.left - m.right;
      const ph = h - m.top - m.bottom;
      this.ox = m.left;
      this.oy = m.top + ph;
      if (spec.equalAspect) {
        // One scale for both axes, chosen so both requested ranges fit; the other axis grows.
        const s = Math.min(pw / (spec.x[1] - spec.x[0]), ph / (spec.y[1] - spec.y[0]));
        this.sx = this.sy = s;
        spec.x = [spec.x[0], spec.x[0] + pw / s];
        spec.y = [spec.y[0], spec.y[0] + ph / s];
      } else {
        this.sx = pw / (spec.x[1] - spec.x[0]);
        this.sy = ph / (spec.y[1] - spec.y[0]);
      }

      const ink = cssVar(c, "--plot-ink", "#333");
      const grid = cssVar(c, "--plot-grid", "#ddd");
      ctx.font = "12px system-ui, sans-serif";
      ctx.lineWidth = 1;

      // Grid and tick labels.
      ctx.fillStyle = ink;
      ctx.strokeStyle = grid;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      niceTicks(spec.x[0], spec.x[1], Math.max(2, Math.floor(pw / 70))).forEach((t) => {
        const [px] = this.toPx(t, 0);
        ctx.beginPath();
        ctx.moveTo(px, m.top);
        ctx.lineTo(px, this.oy);
        ctx.stroke();
        ctx.fillText(formatTick(t), px, this.oy + 4);
      });
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      niceTicks(spec.y[0], spec.y[1], Math.max(2, Math.floor(ph / 45))).forEach((t) => {
        const [, py] = this.toPx(0, t);
        ctx.beginPath();
        ctx.moveTo(m.left, py);
        ctx.lineTo(m.left + pw, py);
        ctx.stroke();
        ctx.fillText(formatTick(t), m.left - 6, py);
      });

      // Axis labels.
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(this.labels.xLabel, m.left + pw / 2, h - 2);
      ctx.save();
      ctx.translate(12, m.top + ph / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textBaseline = "middle";
      ctx.fillText(this.labels.yLabel, 0, 0);
      ctx.restore();

      // Data, clipped to the plot area.
      ctx.save();
      ctx.beginPath();
      ctx.rect(m.left, m.top, pw, ph);
      ctx.clip();
      const toPx = (x, y) => this.toPx(x, y);
      if (spec.decorate) spec.decorate(ctx, toPx, this.sx);
      (spec.series || []).forEach((s) => this.drawSeries(ctx, s));
      ctx.restore();

      ctx.strokeStyle = ink;
      ctx.strokeRect(m.left, m.top, pw, ph);
    }

    drawSeries(ctx, s) {
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = s.width || 2;
      ctx.setLineDash(s.dash || []);
      if (s.type === "line") {
        ctx.beginPath();
        s.points.forEach(([x, y], i) => {
          const [px, py] = this.toPx(x, y);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
      } else if (s.type === "points") {
        ctx.setLineDash([]);
        s.points.forEach((p) => {
          ctx.globalAlpha = p.faded ? 0.25 : 1;
          const [px, py] = this.toPx(p.x, p.y);
          if (p.lo !== undefined && p.hi !== undefined && p.hi > p.lo) {
            const [, pyLo] = this.toPx(p.x, p.lo);
            const [, pyHi] = this.toPx(p.x, p.hi);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(px, pyLo);
            ctx.lineTo(px, pyHi);
            ctx.moveTo(px - 4, pyLo);
            ctx.lineTo(px + 4, pyLo);
            ctx.moveTo(px - 4, pyHi);
            ctx.lineTo(px + 4, pyHi);
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.arc(px, py, s.radius || 4.5, 0, 2 * Math.PI);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
      }
      ctx.setLineDash([]);
    }
  }

  MiniPlot.niceTicks = niceTicks;
  return MiniPlot;
});
