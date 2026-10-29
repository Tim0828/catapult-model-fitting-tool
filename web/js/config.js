/**
 * Lesson configuration: the ONLY file a teacher needs to edit.
 *
 * Fill in the measured dimensions of your printed catapult, the springs or
 * rubber bands you hand out, and which settings the students can control.
 * Lengths in metres, masses in kg, distances shown to students in cm.
 */
window.CATAPULT_CONFIG = {
  title: "Catapult Challenge",

  /** Measured from the printed parts (see docs/TEACHER_GUIDE.md). */
  catapult: {
    lLeft: 0.05, // pivot -> centre of the ball cup
    lRight: 0.05, // pivot -> spring attachment point on the arm
    lFoot: 0.03, // pivot -> spring anchor on the foot
    pivotHeight: 0.08, // pivot -> table/floor the ball lands on
    inertia: 1.5e-5, // arm + cup about the pivot; use rodInertia() or the reference notebook
    mass: 0.01, // ball
  },

  /** Springs / rubber bands. k in N/m, l0 = rest length in m (0 for an ideal spring). */
  springs: [
    { id: "soft", name: "Soft (green)", k: 60, l0: 0.02 },
    { id: "medium", name: "Medium (blue)", k: 100, l0: 0.02 },
    { id: "stiff", name: "Stiff (red)", k: 160, l0: 0.02 },
  ],

  /**
   * Controllable settings. Use `notchesDeg` when the catapult has fixed
   * positions (students then pick from a list); otherwise a slider from
   * minDeg to maxDeg is shown. maxDeg: null means "as far as the geometry allows".
   */
  settings: {
    pullBack: { minDeg: 60, maxDeg: 150, stepDeg: 1, defaultDeg: 110, notchesDeg: null },
    stopAngle: { minDeg: 15, maxDeg: 70, stepDeg: 5, defaultDeg: 30, notchesDeg: [15, 30, 45, 60] },
    defaultSpring: "medium",
  },

  /** Parameters students fit. Set `show: false` to hide a slider. */
  fit: {
    efficiency: { show: true, min: 0.05, max: 1, step: 0.01, initial: 0.6 },
    // Drag slider value is in g/m (quadratic, c = 1/2 rho Cd A) or mN*s/m (linear).
    drag: { show: true, initialModel: "none", models: ["none", "quadratic", "linear"], quadratic: { max: 1, step: 0.01, initial: 0.1 }, linear: { max: 20, step: 0.1, initial: 2 } },
    releaseOffset: { show: true, minDeg: -15, maxDeg: 15, step: 0.5, initial: 0 },
  },

  /** Prediction round. Targets in cm; scoring: lose 1 point per bandCm missed. */
  predict: {
    targetsCm: [50, 80, 110, 140],
    scoring: { bandCm: 5, maxPoints: 10 },
  },

  /** Optional link shown in the header, e.g. "http://catapult.local:5000/". */
  scoreboardUrl: null,
};
