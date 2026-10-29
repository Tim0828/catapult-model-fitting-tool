/**
 * Tiny synchronous test runner plus the test cases. Results are written to
 * #summary (data-status="pass"|"fail") so a headless browser can read them.
 */
(function () {
  "use strict";

  const Model = window.CatapultModel;
  const Analysis = window.CatapultAnalysis;
  const Storage = window.CatapultStorage;
  const MiniPlot = window.MiniPlot;
  const FIX = window.REFERENCE_FIXTURES;

  const results = [];

  function test(name, fn) {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (e) {
      results.push({ name, ok: false, error: e && e.message ? e.message : String(e) });
    }
  }

  function assert(cond, msg) {
    if (!cond) throw new Error(msg || "assertion failed");
  }

  function close(actual, expected, tol, what) {
    const scale = Math.max(1, Math.abs(expected));
    if (!(Math.abs(actual - expected) <= tol * scale)) {
      throw new Error(`${what}: got ${actual}, expected ${expected} (tol ${tol})`);
    }
  }

  /* Model vs Python reference --------------------------------------- */

  FIX.model.forEach((c) => {
    test("reference: " + c.name, () => {
      const p = c.params;
      const e = c.expected;
      close(Model.releasedEnergy(p), e.releasedEnergy, 1e-12, "releasedEnergy");
      close(Model.effectiveMass(p), e.effectiveMass, 1e-12, "effectiveMass");
      close(Model.launchSpeed(p), e.launchSpeed, 1e-12, "launchSpeed");
      Model.launchState(p).forEach((v, i) => close(v, e.launchState[i], 1e-12, "launchState[" + i + "]"));
      close(Model.maxPullBack(p), e.maxPullBack, 1e-12, "maxPullBack");
      const sim = Model.simulate(p);
      assert(sim.ok, "simulation failed: " + sim.error);
      close(sim.range, e.range, 1e-6, "simulate().range");
      close(sim.time, e.time, 1e-6, "simulate().time");
      close(Model.range(p), e.range, 1e-6, "range()");
    });
  });

  /* Model behaviour ------------------------------------------------- */

  test("integrator matches closed form without drag", () => {
    [10, 30, 45, 70].forEach((d) => {
      const p = { thetaF: (d * Math.PI) / 180 };
      close(Model.simulate(p).range, Model.rangeNoDrag(p), 1e-9, "range at " + d + "°");
    });
  });

  test("trajectory starts at the cup and ends on the ground", () => {
    const sim = Model.simulate({ dragModel: "quadratic", drag: 2e-4 }, { trajectory: true });
    const s0 = Model.launchState({});
    const first = sim.trajectory[0];
    const last = sim.trajectory[sim.trajectory.length - 1];
    close(first[0], s0[0], 1e-12, "x0");
    close(first[1], s0[1], 1e-12, "y0");
    assert(last[1] === 0, "last point must be on the ground");
    close(last[0], sim.range, 1e-12, "last x");
    assert(sim.maxHeight > s0[1], "ball should rise");
  });

  test("ball starting below ground is reported, not simulated", () => {
    const sim = Model.simulate({ pivotHeight: 0.03, thetaF: (170 * Math.PI) / 180 });
    assert(!sim.ok && sim.error, "expected an error");
  });

  test("unknown drag model throws", () => {
    let threw = false;
    try {
      Model.simulate({ dragModel: "magic" });
    } catch (e) {
      threw = true;
    }
    assert(threw, "expected a throw");
  });

  test("solveSetting finds the pull-back angle for a target", () => {
    const base = { efficiency: 0.6, l0: 0.02, dragModel: "quadratic", drag: 1e-4 };
    const lo = (40 * Math.PI) / 180;
    const hi = (150 * Math.PI) / 180;
    const target = 1.0;
    const sol = Model.solveSetting(base, "thetaI", target, lo, hi);
    assert(sol.ok, "expected a solution");
    close(sol.range, target, 1e-6, "landing");
    close(Model.range(Object.assign({}, base, { thetaI: sol.value })), target, 1e-6, "re-check");
  });

  test("solveSetting reports unreachable targets", () => {
    const lo = (40 * Math.PI) / 180;
    const hi = (150 * Math.PI) / 180;
    assert(Model.solveSetting({}, "thetaI", 100, lo, hi).reason === "too-far", "too-far");
    assert(Model.solveSetting({}, "thetaI", -1, lo, hi).reason === "too-close", "too-close");
  });

  test("rodInertia: centre pivot is M L^2 / 12", () => {
    close(Model.rodInertia(0.012, 0.05, 0.05, 0), (0.012 * 0.01) / 12, 1e-12, "I");
  });

  /* Analysis -------------------------------------------------------- */

  test("summarize: mean, sample std, min, max", () => {
    const s = Analysis.summarize([1, 2, 3, 4, NaN]);
    assert(s.n === 4, "n");
    close(s.mean, 2.5, 1e-12, "mean");
    close(s.std, Math.sqrt(5 / 3), 1e-12, "std");
    assert(s.min === 1 && s.max === 4, "min/max");
    assert(Analysis.summarize([]) === null, "empty -> null");
    assert(Analysis.summarize([5]).std === 0, "single shot has no spread");
  });

  test("compare: RMS of model minus measured mean, skipping empty rows", () => {
    const rows = [{ distances: [1, 1.2] }, { distances: [2] }, { distances: [] }];
    const predictions = [1.0, 2.3, 9];
    let i = 0;
    const c = Analysis.compare(rows, () => predictions[i++]);
    assert(c.n === 2, "two rows with data");
    close(c.rows[0].residual, -0.1, 1e-12, "residual 0");
    close(c.rows[1].residual, 0.3, 1e-12, "residual 1");
    assert(c.rows[2].residual === null, "empty row");
    close(c.rms, Math.sqrt((0.01 + 0.09) / 2), 1e-12, "rms");
    assert(Analysis.compare([], () => 0).rms === null, "no data -> null");
  });

  test("scoreShot matches the Python scoreboard", () => {
    FIX.scoring.forEach((c) => {
      const got = Analysis.scoreShot(c.miss);
      assert(got === c.points, `miss ${c.miss}: got ${got}, expected ${c.points}`);
    });
  });

  /* Storage --------------------------------------------------------- */

  test("URL hash round trip keeps the data (including non-ASCII text)", () => {
    const state = { team: "Team Ïjsbeer 🚀", measurements: [{ springId: "soft", distancesCm: [80, 81.5] }] };
    const back = Storage.decodeHash(Storage.encodeHash(state));
    assert(back.team === state.team, "team");
    assert(JSON.stringify(back.measurements) === JSON.stringify(state.measurements), "measurements");
    assert(back.version === Storage.VERSION, "version");
  });

  test("bad or foreign hashes are ignored", () => {
    assert(Storage.decodeHash("") === null, "empty");
    assert(Storage.decodeHash("#something") === null, "other hash");
    assert(Storage.decodeHash("#s=@@@") === null, "garbage");
    const wrongVersion = "#s=" + btoa(JSON.stringify({ version: 999 }));
    assert(Storage.decodeHash(wrongVersion) === null, "wrong version");
  });

  /* Plot helpers ---------------------------------------------------- */

  test("niceTicks gives round steps covering the range", () => {
    const t = MiniPlot.niceTicks(0, 2.3, 5);
    assert(JSON.stringify(t) === JSON.stringify([0, 0.5, 1, 1.5, 2]), "got " + JSON.stringify(t));
    const u = MiniPlot.niceTicks(60, 150, 6);
    assert(u[0] === 60 && u[u.length - 1] === 140, "got " + JSON.stringify(u));
  });

  /* Report ---------------------------------------------------------- */

  const failed = results.filter((r) => !r.ok);
  const summary = document.getElementById("summary");
  summary.dataset.status = failed.length ? "fail" : "pass";
  summary.className = failed.length ? "fail" : "pass";
  summary.textContent = `${results.length - failed.length}/${results.length} passed` + (failed.length ? `, ${failed.length} FAILED` : "");
  document.getElementById("log").textContent = results
    .map((r) => (r.ok ? "ok   " : "FAIL ") + r.name + (r.ok ? "" : "\n     " + r.error))
    .join("\n");
  document.title = (failed.length ? "FAIL" : "PASS") + " – Catapult tests";
})();
