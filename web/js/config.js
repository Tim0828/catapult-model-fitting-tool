/**
 * Lesson configuration: the ONLY file a teacher needs to edit.
 *
 * Fill in the dimensions of your printed catapult, the elastic bands, and
 * which settings the students can control. Lengths in metres, masses in kg,
 * distances shown to students in cm.
 */
window.CATAPULT_CONFIG = {
  title: "Catapult Challenge",

  /**
   * STARTING values of the catapult measurements. Students see and can
   * re-measure all of these in the "Catapult & bands" tab. For a "check the
   * measurements" exercise, enter values here that are a little off.
   */
  catapult: {
    lLeft: 0.05, // pivot -> centre of the ball cup
    lRight: 0.05, // pivot -> band hook on the arm
    lFoot: 0.08, // pivot -> band hook on the foot
    pivotHeight: 0.08, // pivot -> table/floor the ball lands on
    ballMass: 0.01, // kg
    armMass: 0.01, // kg, printed arm (treated as a uniform rod)
    cupMass: 0.003, // kg, cup at the end of the arm (0 if it is weighed with the arm)
    bandK: 20, // N/m, stiffness of ONE band: students should estimate this
    bandL0: 0.04, // m, rest length of one band (as stretched between the hooks)
  },

  /** Number of elastic bands students can put on (they act in parallel: k_total = n * k). */
  bands: { min: 1, max: 6, default: 2 },

  /**
   * Controllable settings. Use `notchesDeg` when the catapult has fixed
   * positions (students then pick from a list); otherwise a slider from
   * minDeg to maxDeg is shown. maxDeg: null means "as far as the geometry allows".
   */
  settings: {
    pullBack: {
      minDeg: 60,
      maxDeg: 150,
      stepDeg: 1,
      defaultDeg: 110,
      notchesDeg: null,
    },
    stopAngle: {
      minDeg: 15,
      maxDeg: 70,
      stepDeg: 5,
      defaultDeg: 30,
      notchesDeg: [10, 20, 30, 40, 50, 60],
    },
  },

  /** Parameters students fit. Set `show: false` to hide a slider. */
  fit: {
    efficiency: { show: true, min: 0.05, max: 1, step: 0.01, initial: 0.6 },
    // Drag slider value is in g/m (quadratic, c = 1/2 rho Cd A) or mN*s/m (linear).
    drag: {
      show: true,
      initialModel: "none",
      models: ["none", "quadratic", "linear"],
      quadratic: { max: 1, step: 0.01, initial: 0.1 },
      linear: { max: 20, step: 0.1, initial: 2 },
    },
    releaseOffset: {
      show: true,
      minDeg: -15,
      maxDeg: 15,
      step: 0.5,
      initial: 0,
    },
  },

  /** Prediction round. Targets in cm; scoring: lose 1 point per bandCm missed. */
  predict: {
    targetsCm: [50, 80, 110, 140],
    scoring: { bandCm: 5, maxPoints: 10 },
  },

  /** Optional link shown in the header, e.g. "http://catapult.local:5000/". */
  scoreboardUrl: null,
};
