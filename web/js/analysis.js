/**
 * Measurement statistics, fit quality, band calibration and prediction scoring.
 *
 * Pure functions, no DOM. Distances are in metres. The scoring rule must stay
 * identical to scoreboard/scoring.py (both are checked against the same cases
 * in the test suites).
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CatapultAnalysis = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function mean(xs) {
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  }

  /** Sample standard deviation (n - 1); 0 for fewer than two values. */
  function sampleStd(xs) {
    if (xs.length < 2) return 0;
    const m = mean(xs);
    return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
  }

  /** Summary of repeated shots at one setting, or null if there are none. */
  function summarize(distances) {
    const xs = distances.filter((d) => Number.isFinite(d));
    if (xs.length === 0) return null;
    return {
      n: xs.length,
      mean: mean(xs),
      std: sampleStd(xs),
      min: Math.min.apply(null, xs),
      max: Math.max.apply(null, xs),
    };
  }

  /**
   * Compare the model with each measurement row.
   *
   * @param {object[]} measurements  rows with a `distances` array
   * @param {(row: object) => number} predict  model landing distance for a row
   * @returns {{rows: object[], rms: number|null, n: number}}
   *   rows: {row, stats, predicted, residual} (residual = model - measured mean);
   *   rms over rows that have shots, null when there are none.
   */
  function compare(measurements, predict) {
    const rows = measurements.map((row) => {
      const stats = summarize(row.distances || []);
      const predicted = predict(row);
      return { row, stats, predicted, residual: stats ? predicted - stats.mean : null };
    });
    const res = rows.filter((r) => r.residual !== null && Number.isFinite(r.residual));
    const rms = res.length ? Math.sqrt(mean(res.map((r) => r.residual ** 2))) : null;
    return { rows, rms, n: res.length };
  }

  /**
   * Points for one prediction shot: full points within one band of the target,
   * then one point less per extra band missed, never below zero.
   */
  function scoreShot(missMetres, rules) {
    const r = Object.assign({ bandCm: 5, maxPoints: 10 }, rules);
    const bands = Math.floor((Math.abs(missMetres) * 100) / r.bandCm + 1e-9);
    return Math.max(r.maxPoints - bands, 0);
  }

  /** Least-squares line y = slope * x + intercept, or null if it is undetermined. */
  function fitLine(xs, ys) {
    if (xs.length < 2) return null;
    const mx = mean(xs);
    const my = mean(ys);
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    xs.forEach((x, i) => {
      sxx += (x - mx) ** 2;
      sxy += (x - mx) * (ys[i] - my);
      syy += (ys[i] - my) ** 2;
    });
    if (sxx === 0) return null;
    const slope = sxy / sxx;
    return { slope, intercept: my - slope * mx, r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy) };
  }

  /**
   * Band stiffness from a hanging-weight test: Hooke's law F = k (L - L0).
   *
   * @param {{lengthM: number, forceN: number}[]} points  band length and pulling force
   * @returns {{k: number, l0: number, r2: number}|null}  null if no positive stiffness fits
   */
  function fitBand(points) {
    const fit = fitLine(
      points.map((p) => p.lengthM),
      points.map((p) => p.forceN)
    );
    if (!fit || !(fit.slope > 0)) return null;
    return { k: fit.slope, l0: -fit.intercept / fit.slope, r2: fit.r2 };
  }

  return { mean, sampleStd, summarize, compare, scoreShot, fitLine, fitBand };
});
