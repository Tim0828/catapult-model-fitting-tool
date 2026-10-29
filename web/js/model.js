/**
 * Catapult physics model (browser port of reference/catapult_model.py).
 *
 * Pure functions only: no DOM access, so the same file runs in the app, in the
 * browser test page and in any JS runtime. Units are SI, angles in radians.
 *
 * Conventions (origin on the floor below the pivot, x forward, y up): every angle
 * is the angle of the throwing arm (pivot -> ball cup) from the vertical. The
 * arm swings from the pull-back angle thetaI to the stop angle thetaF; the ball
 * is released perpendicular to the arm, so its elevation equals thetaF
 * (+ releaseOffset). See docs/MODEL.md for the derivation.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CatapultModel = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const G = 9.81;
  const DRAG_MODELS = ["none", "linear", "quadratic"];

  /** Default parameters; keep in sync with CatapultParams in the Python reference. */
  const DEFAULT_PARAMS = Object.freeze({
    lLeft: 0.05, // m, pivot -> ball cup
    lRight: 0.05, // m, pivot -> spring attachment
    lFoot: 0.03, // m, pivot -> spring anchor on the foot
    pivotHeight: 0.08, // m, pivot above the landing surface
    thetaI: (120 * Math.PI) / 180, // pull-back angle
    thetaF: (30 * Math.PI) / 180, // stop angle = launch elevation
    k: 100, // N/m, spring constant
    l0: 0, // m, spring rest length
    inertia: 1.5e-5, // kg m^2, rod (+ cup) about the pivot
    mass: 0.01, // kg, ball
    efficiency: 1, // fraction of spring energy converted to kinetic energy
    dragModel: "none",
    drag: 0, // b [N s/m] (linear) or c [kg/m] (quadratic)
    releaseOffset: 0, // rad
    g: G,
  });

  function withDefaults(params) {
    return Object.assign({}, DEFAULT_PARAMS, params);
  }

  /** Moment of inertia of a uniform rod pivoting at an interior point, plus a point-mass cup. */
  function rodInertia(rodMass, lLeft, lRight, cupMass) {
    const length = lLeft + lRight;
    return (rodMass * (lLeft ** 3 + lRight ** 3)) / (3 * length) + (cupMass || 0) * lLeft ** 2;
  }

  function springLength(p, theta) {
    return Math.sqrt(p.lFoot ** 2 + p.lRight ** 2 - 2 * p.lFoot * p.lRight * Math.cos(theta));
  }

  /** Elastic energy at arm angle theta; a slack spring or band stores nothing. */
  function springEnergy(p, theta) {
    const stretch = Math.max(springLength(p, theta) - p.l0, 0);
    return 0.5 * p.k * stretch * stretch;
  }

  function releasedEnergy(p) {
    return Math.max(springEnergy(p, p.thetaI) - springEnergy(p, p.thetaF), 0);
  }

  /** KE = 1/2 m_eff v^2, with the rod contributing I / lLeft^2. */
  function effectiveMass(p) {
    return p.inertia / p.lLeft ** 2 + p.mass;
  }

  function launchSpeed(p) {
    return Math.sqrt((2 * p.efficiency * releasedEnergy(p)) / effectiveMass(p));
  }

  /** State [x, y, vx, vy] of the ball at release. */
  function launchState(p) {
    const v0 = launchSpeed(p);
    const th = p.thetaF + p.releaseOffset;
    return [
      -p.lLeft * Math.sin(th),
      p.pivotHeight + p.lLeft * Math.cos(th),
      v0 * Math.cos(th),
      v0 * Math.sin(th),
    ];
  }

  /** Largest arm angle before the ball cup touches the ground. */
  function maxPullBack(p) {
    return p.pivotHeight >= p.lLeft ? Math.PI : Math.acos(-p.pivotHeight / p.lLeft);
  }

  function derivative(p, s) {
    const vx = s[2];
    const vy = s[3];
    let a = 0; // drag acceleration per unit velocity
    if (p.dragModel === "linear") a = p.drag / p.mass;
    else if (p.dragModel === "quadratic") a = (p.drag / p.mass) * Math.hypot(vx, vy);
    return [vx, vy, -a * vx, -a * vy - p.g];
  }

  /** One classical Runge-Kutta step of size h. */
  function rk4Step(p, s, h) {
    const k1 = derivative(p, s);
    const k2 = derivative(p, s.map((v, i) => v + (h / 2) * k1[i]));
    const k3 = derivative(p, s.map((v, i) => v + (h / 2) * k2[i]));
    const k4 = derivative(p, s.map((v, i) => v + h * k3[i]));
    return s.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  }

  /**
   * Fly the ball until it hits the ground (y = 0).
   *
   * Fixed-step RK4; once a step crosses y = 0 the landing time is found by
   * bisecting the step size of a single RK4 step from the last state above
   * ground. This replaces the notebook's np.interp on a non-monotonic y.
   *
   * @param {object} params  model parameters (missing ones use DEFAULT_PARAMS)
   * @param {object} [opts]  {trajectory: bool, dt: number}
   * @returns {{ok: boolean, range: number, time: number, v0: number,
   *            maxHeight: number, trajectory: number[][]|null, error?: string}}
   */
  function simulate(params, opts) {
    const p = withDefaults(params);
    const o = Object.assign({ trajectory: false, dt: 1e-3 }, opts);
    if (!DRAG_MODELS.includes(p.dragModel)) throw new Error("unknown drag model " + p.dragModel);

    const v0 = launchSpeed(p);
    let s = launchState(p);
    const result = { ok: true, range: s[0], time: 0, v0: v0, maxHeight: s[1], trajectory: null };
    if (o.trajectory) result.trajectory = [[s[0], s[1]]];
    if (!(s[1] > 0)) {
      result.ok = false;
      result.error = "The ball starts at or below the ground: check the angles.";
      return result;
    }

    const maxSteps = 1e6;
    let t = 0;
    for (let n = 0; n < maxSteps; n++) {
      const next = rk4Step(p, s, o.dt);
      if (next[1] > 0) {
        s = next;
        t += o.dt;
        result.maxHeight = Math.max(result.maxHeight, s[1]);
        if (o.trajectory) result.trajectory.push([s[0], s[1]]);
        continue;
      }
      // Landing inside this step: bisect on the step size.
      let lo = 0;
      let hi = o.dt;
      let landed = next;
      for (let i = 0; i < 60 && hi - lo > 1e-15; i++) {
        const mid = 0.5 * (lo + hi);
        const trial = rk4Step(p, s, mid);
        if (trial[1] > 0) lo = mid;
        else {
          hi = mid;
          landed = trial;
        }
      }
      result.time = t + hi;
      result.range = landed[0];
      if (o.trajectory) result.trajectory.push([landed[0], 0]);
      return result;
    }
    result.ok = false;
    result.error = "Flight did not end; parameters are out of range.";
    return result;
  }

  /** Landing distance; uses the exact closed form when there is no drag. */
  function range(params) {
    const p = withDefaults(params);
    if (p.dragModel === "none" || p.drag === 0) {
      return launchState(p)[1] > 0 ? rangeNoDrag(p) : launchState(p)[0];
    }
    return simulate(p).range;
  }

  /** Closed-form range without drag (used by tests). */
  function rangeNoDrag(params) {
    const p = withDefaults(params);
    const [x0, y0, vx, vy] = launchState(p);
    const t = (vy + Math.sqrt(vy * vy + 2 * p.g * y0)) / p.g;
    return x0 + vx * t;
  }

  /**
   * Find the value of one setting (e.g. "thetaI") that makes the ball land at
   * `target`, by bisection over [lo, hi]. Range must be monotonic in that
   * setting over the interval (true for the pull-back angle).
   *
   * @returns {{ok: boolean, value: number, range: number, reason?: string}}
   */
  function solveSetting(params, key, target, lo, hi) {
    const at = (v) => range(Object.assign({}, params, { [key]: v }));
    let rLo = at(lo);
    let rHi = at(hi);
    const increasing = rHi >= rLo;
    if (target < Math.min(rLo, rHi)) return { ok: false, value: increasing ? lo : hi, range: Math.min(rLo, rHi), reason: "too-close" };
    if (target > Math.max(rLo, rHi)) return { ok: false, value: increasing ? hi : lo, range: Math.max(rLo, rHi), reason: "too-far" };
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      const r = at(mid);
      if ((r < target) === increasing) {
        lo = mid;
        rLo = r;
      } else {
        hi = mid;
        rHi = r;
      }
    }
    const value = 0.5 * (lo + hi);
    return { ok: true, value: value, range: at(value) };
  }

  // Public helpers accept partial parameter objects.
  const lift = (fn) => (params, ...rest) => fn(withDefaults(params), ...rest);

  return {
    G,
    DRAG_MODELS,
    DEFAULT_PARAMS,
    withDefaults,
    rodInertia,
    springLength: lift(springLength),
    springEnergy: lift(springEnergy),
    releasedEnergy: lift(releasedEnergy),
    effectiveMass: lift(effectiveMass),
    launchSpeed: lift(launchSpeed),
    launchState: lift(launchState),
    maxPullBack: lift(maxPullBack),
    simulate,
    range,
    rangeNoDrag,
    solveSetting,
  };
});
