/**
 * Catapult Challenge app: wires the model, analysis, storage and plots to the page.
 *
 * Data flow: every user action updates `state` and calls `scheduleRender()`.
 * `render()` recomputes everything from `state` (it is cheap) and saves it.
 * Tables and forms are rebuilt only when rows are added or removed, so typing
 * in an input never loses focus; their computed cells are refreshed in place.
 */
(function () {
  "use strict";

  const CFG = window.CATAPULT_CONFIG;
  const Model = window.CatapultModel;
  const Analysis = window.CatapultAnalysis;
  const Storage = window.CatapultStorage;
  const MiniPlot = window.MiniPlot;

  const G = Model.G;
  const $ = (id) => document.getElementById(id);
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const cm = (m) => m * 100;
  const fmtCm = (m) => (Number.isFinite(m) ? Math.round(cm(m)) + " cm" : "–");
  /** Spread-sized values: one decimal below 10 cm so small spreads do not show as "± 0". */
  const fmtSpreadCm = (m) => (cm(m) < 10 ? cm(m).toFixed(1) : String(Math.round(cm(m)))) + " cm";
  const fmtDeg = (d) => Math.round(d * 10) / 10 + "°";
  const fmtBands = (n) => n + (n === 1 ? " band" : " bands");
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const finite = (v, fallback) => (Number.isFinite(v) ? v : fallback);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /** Text from user data is always inserted as text, never as HTML. */
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === undefined || v === null || v === false) return;
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (k in node && k !== "list") node[k] = v;
      else node.setAttribute(k, v === true ? "" : v);
    });
    children.flat().forEach((c) => node.append(c instanceof Node ? c : String(c)));
    return node;
  }

  /* ------------------------------------------------------------------ */
  /* State                                                              */
  /* ------------------------------------------------------------------ */

  const SET = CFG.settings;
  const FIT = CFG.fit;
  const BANDS = CFG.bands;
  const TABS = ["catapult", "measure", "predict"];

  function defaultState() {
    return {
      team: "",
      settings: { bands: BANDS.default, pullBackDeg: SET.pullBack.defaultDeg, stopDeg: SET.stopAngle.defaultDeg },
      fit: {
        efficiency: FIT.efficiency.initial,
        dragModel: FIT.drag.initialModel,
        dragQuadratic: FIT.drag.quadratic.initial, // g/m
        dragLinear: FIT.drag.linear.initial, // mN s/m
        releaseOffsetDeg: FIT.releaseOffset.initial,
      },
      catapult: Object.assign({}, CFG.catapult), // students' own measurements, SI units
      calibration: [], // hanging-weight test of one band: {id, massG, lengthCm}
      measurements: [],
      predictions: [],
      xAxis: "pullBackDeg",
      targetCm: null,
      tab: "measure",
    };
  }

  /** Merge a loaded document over the defaults, dropping anything malformed. */
  function normalizeState(raw) {
    const s = defaultState();
    if (!raw || typeof raw !== "object") return s;
    const num = (v, d) => finite(Number(v), d);
    const settingsOf = (o) => ({
      bands: clamp(Math.round(num(o && o.bands, s.settings.bands)), BANDS.min, BANDS.max),
      pullBackDeg: num(o && o.pullBackDeg, s.settings.pullBackDeg),
      stopDeg: num(o && o.stopDeg, s.settings.stopDeg),
    });

    s.team = typeof raw.team === "string" ? raw.team.slice(0, 40) : "";
    s.settings = settingsOf(raw.settings);
    const f = raw.fit || {};
    s.fit = {
      efficiency: num(f.efficiency, s.fit.efficiency),
      dragModel: Model.DRAG_MODELS.includes(f.dragModel) ? f.dragModel : s.fit.dragModel,
      dragQuadratic: num(f.dragQuadratic, s.fit.dragQuadratic),
      dragLinear: num(f.dragLinear, s.fit.dragLinear),
      releaseOffsetDeg: num(f.releaseOffsetDeg, s.fit.releaseOffsetDeg),
    };
    const c = raw.catapult || {};
    CATAPULT_FIELDS.forEach((field) => {
      const v = Number(c[field.key]);
      if (Number.isFinite(v) && v >= field.min) s.catapult[field.key] = v;
    });
    s.calibration = (Array.isArray(raw.calibration) ? raw.calibration : []).map((r) => ({
      id: typeof r.id === "string" ? r.id : newId(),
      massG: Number.isFinite(r.massG) ? r.massG : null,
      lengthCm: Number.isFinite(r.lengthCm) ? r.lengthCm : null,
    }));
    s.measurements = (Array.isArray(raw.measurements) ? raw.measurements : []).map((m) =>
      Object.assign({ id: typeof m.id === "string" ? m.id : newId() }, settingsOf(m), {
        distancesCm: (Array.isArray(m.distancesCm) ? m.distancesCm : []).map(Number).filter(Number.isFinite),
      })
    );
    s.predictions = (Array.isArray(raw.predictions) ? raw.predictions : []).map((p) =>
      Object.assign({ id: typeof p.id === "string" ? p.id : newId() }, settingsOf(p), {
        targetCm: num(p.targetCm, 0),
        predictedCm: num(p.predictedCm, 0),
        actualCm: Number.isFinite(p.actualCm) ? p.actualCm : null,
      })
    );
    s.xAxis = ["pullBackDeg", "stopDeg", "bands"].includes(raw.xAxis) ? raw.xAxis : "pullBackDeg";
    s.targetCm = Number.isFinite(raw.targetCm) ? raw.targetCm : null;
    s.tab = TABS.includes(raw.tab) ? raw.tab : "measure";
    return s;
  }

  /**
   * Catapult measurements shown to students: state key, label, display unit,
   * SI -> display factor, smallest allowed SI value.
   */
  const CATAPULT_FIELDS = [
    { key: "lLeft", label: "Pivot → ball cup", unit: "cm", scale: 100, min: 1e-3 },
    { key: "lRight", label: "Pivot → band hook on arm", unit: "cm", scale: 100, min: 1e-3 },
    { key: "lFoot", label: "Pivot → band hook on foot", unit: "cm", scale: 100, min: 1e-3 },
    { key: "pivotHeight", label: "Pivot height above table", unit: "cm", scale: 100, min: 1e-3 },
    { key: "ballMass", label: "Ball mass", unit: "g", scale: 1000, min: 1e-4 },
    { key: "armMass", label: "Arm mass", unit: "g", scale: 1000, min: 0 },
    { key: "cupMass", label: "Cup mass (if separate)", unit: "g", scale: 1000, min: 0 },
    { key: "bandK", label: "Stiffness of one band k", unit: "N/m", scale: 1, min: 1e-3 },
    { key: "bandL0", label: "Rest length of one band", unit: "cm", scale: 100, min: 0 },
  ];

  function loadInitialState() {
    const fromHash = Storage.decodeHash(location.hash);
    const local = Storage.load();
    if (fromHash) {
      const hasLocalWork = local && ((local.measurements || []).length || (local.predictions || []).length);
      const msg = "Open the shared link? This replaces the data on this device.";
      if (!hasLocalWork || JSON.stringify(local) === JSON.stringify(fromHash) || window.confirm(msg)) {
        return normalizeState(fromHash);
      }
    }
    return normalizeState(local);
  }

  let state = loadInitialState();

  /* ------------------------------------------------------------------ */
  /* Model glue                                                         */
  /* ------------------------------------------------------------------ */

  function armInertia(c) {
    return Model.rodInertia(c.armMass, c.lLeft, c.lRight, c.cupMass);
  }

  /** Full model parameters for a set of catapult settings and the current fit. */
  function paramsFor(settings) {
    const c = state.catapult;
    const f = state.fit;
    let drag = 0;
    if (f.dragModel === "quadratic") drag = f.dragQuadratic / 1000; // g/m -> kg/m
    else if (f.dragModel === "linear") drag = f.dragLinear / 1000; // mN s/m -> N s/m
    return Object.assign({}, Model.DEFAULT_PARAMS, {
      lLeft: c.lLeft,
      lRight: c.lRight,
      lFoot: c.lFoot,
      pivotHeight: c.pivotHeight,
      mass: c.ballMass,
      inertia: armInertia(c),
      k: settings.bands * c.bandK, // identical bands side by side add their stiffness
      l0: c.bandL0,
      thetaI: rad(settings.pullBackDeg),
      thetaF: rad(settings.stopDeg),
      efficiency: f.efficiency,
      dragModel: f.dragModel,
      drag: drag,
      releaseOffset: rad(f.releaseOffsetDeg),
    });
  }

  /** Allowed values of a setting; with notches the range spans the notches. */
  function settingRange(key) {
    if (key === "bands") return { min: BANDS.min, max: BANDS.max, step: 1 };
    const c = key === "stopDeg" ? SET.stopAngle : SET.pullBack;
    if (c.notchesDeg && c.notchesDeg.length) {
      return { min: Math.min(...c.notchesDeg), max: Math.max(...c.notchesDeg), step: c.stepDeg };
    }
    if (key === "stopDeg") return { min: c.minDeg, max: c.maxDeg, step: c.stepDeg };
    const geomMax = Math.floor(deg(Model.maxPullBack(paramsFor(state.settings))));
    return { min: c.minDeg, max: Math.min(c.maxDeg === null ? geomMax : c.maxDeg, geomMax), step: c.stepDeg };
  }

  /** Snap a setting to what the real catapult allows (a notch, a slider step, a whole band). */
  function snap(key, value) {
    const notches = { pullBackDeg: SET.pullBack.notchesDeg, stopDeg: SET.stopAngle.notchesDeg }[key];
    if (notches && notches.length) {
      return notches.reduce((best, n) => (Math.abs(n - value) < Math.abs(best - value) ? n : best));
    }
    const r = settingRange(key);
    return clamp(Math.round(value / r.step) * r.step, r.min, r.max);
  }

  const SETTING_KEYS = ["bands", "pullBackDeg", "stopDeg"];
  const close = (a, b) => Math.abs(a - b) < 0.25;

  /** Same catapult settings, optionally ignoring one of them (the plotted one). */
  function sameSettings(a, b, except) {
    return SETTING_KEYS.every((k) => k === except || close(a[k], b[k]));
  }

  function settingText(s) {
    return fmtBands(s.bands) + ", " + fmtDeg(s.pullBackDeg) + " / " + fmtDeg(s.stopDeg);
  }

  /* ------------------------------------------------------------------ */
  /* Controls                                                           */
  /* ------------------------------------------------------------------ */

  const controls = {}; // key -> {sync(), setLimits()} to push state back into inputs

  /**
   * A labelled slider, or a select when `options` is given.
   * @param {object} o {key, label, help, min, max, step, options: [{value, text}],
   *                    format(v), get(), set(v)}
   */
  function makeControl(o) {
    const id = "ctl-" + o.key;
    const out = el("output", { htmlFor: id });
    let input;
    if (o.options) {
      input = el("select", { id: id }, o.options.map((opt) => el("option", { value: String(opt.value) }, opt.text)));
      input.addEventListener("change", () => {
        const opt = o.options.find((x) => String(x.value) === input.value);
        o.set(opt.value);
        scheduleRender();
      });
    } else {
      input = el("input", { id: id, type: "range", min: o.min, max: o.max, step: o.step });
      input.addEventListener("input", () => {
        o.set(Number(input.value));
        out.value = o.format(Number(input.value));
        scheduleRender();
      });
    }
    const wrap = el(
      "div",
      { class: "control" },
      el("label", { htmlFor: id }, o.label, o.options ? "" : out),
      input,
      o.help ? el("div", { class: "help" }, o.help) : ""
    );
    controls[o.key] = {
      wrap: wrap,
      sync() {
        const v = o.get();
        if (input.value !== String(v)) input.value = String(v);
        if (!o.options) out.value = o.format(v);
      },
      setLimits(min, max) {
        if (!o.options) {
          input.min = min;
          input.max = max;
        }
      },
    };
    return wrap;
  }

  function angleControl(key, cfg, label, help) {
    const notches = cfg.notchesDeg && cfg.notchesDeg.length ? cfg.notchesDeg : null;
    const r = settingRange(key);
    return makeControl({
      key: key,
      label: label,
      help: help,
      min: r.min,
      max: r.max,
      step: r.step,
      options: notches ? notches.map((n) => ({ value: n, text: n + "°" })) : null,
      format: fmtDeg,
      get: () => state.settings[key],
      set: (v) => (state.settings[key] = v),
    });
  }

  function buildSettingsControls() {
    const bandOptions = [];
    for (let n = BANDS.min; n <= BANDS.max; n++) bandOptions.push({ value: n, text: fmtBands(n) });
    $("settings-controls").replaceChildren(
      makeControl({
        key: "bands",
        label: "Elastic bands",
        help: "More bands store more energy.",
        options: bandOptions,
        get: () => state.settings.bands,
        set: (v) => (state.settings.bands = v),
      }),
      angleControl("pullBackDeg", SET.pullBack, "Pull-back angle", "How far you pull the arm back."),
      angleControl("stopDeg", SET.stopAngle, "Stop angle", "Where the arm hits the stop. This is also the launch angle.")
    );
  }

  function buildFitControls() {
    const items = [];
    if (FIT.efficiency.show) {
      items.push(
        makeControl({
          key: "efficiency",
          label: "Efficiency",
          help: "How much of the band energy ends up in the flying ball. The rest is lost to friction, wobble, sound…",
          min: FIT.efficiency.min,
          max: FIT.efficiency.max,
          step: FIT.efficiency.step,
          format: (v) => Math.round(v * 100) + "%",
          get: () => state.fit.efficiency,
          set: (v) => (state.fit.efficiency = v),
        })
      );
    }
    if (FIT.drag.show) {
      const labels = { none: "No air resistance (model 1)", quadratic: "Air resistance ∝ speed² (model 2)", linear: "Air resistance ∝ speed" };
      const q = FIT.drag.quadratic;
      const l = FIT.drag.linear;
      items.push(
        makeControl({
          key: "dragModel",
          label: "Air resistance",
          options: FIT.drag.models.map((m) => ({ value: m, text: labels[m] })),
          get: () => state.fit.dragModel,
          set: (v) => (state.fit.dragModel = v),
        }),
        makeControl({
          key: "dragQuadratic",
          label: "Air resistance strength",
          help: "c in F = c·v². A ping-pong ball is about 0.1 g/m.",
          min: 0,
          max: q.max,
          step: q.step,
          format: (v) => v.toFixed(2) + " g/m",
          get: () => state.fit.dragQuadratic,
          set: (v) => (state.fit.dragQuadratic = v),
        }),
        makeControl({
          key: "dragLinear",
          label: "Air resistance strength",
          help: "b in F = b·v.",
          min: 0,
          max: l.max,
          step: l.step,
          format: (v) => v.toFixed(1) + " mN·s/m",
          get: () => state.fit.dragLinear,
          set: (v) => (state.fit.dragLinear = v),
        })
      );
    }
    if (FIT.releaseOffset.show) {
      const r = FIT.releaseOffset;
      items.push(
        makeControl({
          key: "releaseOffsetDeg",
          label: "Release angle correction",
          help: "The ball may leave the cup a bit before or after the arm hits the stop.",
          min: r.minDeg,
          max: r.maxDeg,
          step: r.step,
          format: (v) => (v > 0 ? "+" : "") + fmtDeg(v),
          get: () => state.fit.releaseOffsetDeg,
          set: (v) => (state.fit.releaseOffsetDeg = v),
        })
      );
    }
    $("fit-controls").replaceChildren(...items);
  }

  function refreshLimits() {
    const r = settingRange("pullBackDeg");
    if (controls.pullBackDeg) controls.pullBackDeg.setLimits(r.min, r.max);
  }

  function syncControls() {
    Object.values(controls).forEach((c) => c.sync());
    const dm = state.fit.dragModel;
    if (controls.dragQuadratic) controls.dragQuadratic.wrap.hidden = dm !== "quadratic";
    if (controls.dragLinear) controls.dragLinear.wrap.hidden = dm !== "linear";
    if ($("team-name").value !== state.team) $("team-name").value = state.team;
    $("x-axis").value = state.xAxis;
  }

  function applySettings(s) {
    SETTING_KEYS.forEach((k) => (state.settings[k] = s[k]));
    syncControls();
    scheduleRender();
  }

  /* ------------------------------------------------------------------ */
  /* Catapult & bands tab                                               */
  /* ------------------------------------------------------------------ */

  const roundForInput = (v) => +v.toPrecision(4);

  function buildCatapultForm() {
    $("catapult-form").replaceChildren(
      ...CATAPULT_FIELDS.map((field) => {
        const input = el("input", {
          type: "number",
          step: "any",
          min: String(field.min * field.scale),
          inputMode: "decimal",
          id: "cat-" + field.key,
          value: roundForInput(state.catapult[field.key] * field.scale),
          oninput: () => {
            const v = Number(input.value) / field.scale;
            const ok = input.value !== "" && Number.isFinite(v) && v >= field.min;
            input.classList.toggle("invalid", !ok);
            if (!ok) return;
            state.catapult[field.key] = v;
            refreshLimits();
            scheduleRender();
          },
        });
        return el("label", { htmlFor: input.id }, el("span", {}, field.label), el("span", { class: "with-unit" }, input, field.unit));
      })
    );
  }

  /** Calibration rows that have both numbers, converted to SI. */
  function calibrationPoints() {
    return state.calibration
      .filter((r) => Number.isFinite(r.massG) && Number.isFinite(r.lengthCm))
      .map((r) => ({ id: r.id, lengthM: r.lengthCm / 100, forceN: (r.massG / 1000) * G }));
  }

  function rebuildCalibrationTable() {
    const body = $("calib-table").tBodies[0];
    if (!state.calibration.length) {
      body.replaceChildren(el("tr", {}, el("td", { colSpan: 5, class: "empty" }, "No weights yet. Start with the band hanging without weight.")));
      return;
    }
    const numberInput = (row, key, label) => {
      const input = el("input", {
        type: "number",
        min: "0",
        step: "any",
        inputMode: "decimal",
        value: row[key] === null ? "" : row[key],
        "aria-label": label,
        oninput: () => {
          const v = Number(input.value);
          row[key] = input.value !== "" && Number.isFinite(v) && v >= 0 ? v : null;
          scheduleRender();
        },
      });
      return input;
    };
    body.replaceChildren(
      ...state.calibration.map((row, i) =>
        el(
          "tr",
          { "data-id": row.id },
          el("td", {}, String(i + 1)),
          el("td", {}, numberInput(row, "massG", "Weight in grams, row " + (i + 1))),
          el("td", {}, numberInput(row, "lengthCm", "Band length in cm, row " + (i + 1))),
          el("td", { "data-cell": "force" }),
          el(
            "td",
            {},
            el(
              "button",
              {
                type: "button",
                class: "icon-btn",
                "aria-label": "Delete weight " + (i + 1),
                onclick: () => {
                  state.calibration = state.calibration.filter((x) => x !== row);
                  rebuildCalibrationTable();
                  scheduleRender();
                },
              },
              "✕"
            )
          )
        )
      )
    );
  }

  const calibPlot = new MiniPlot($("calib-plot"), { xLabel: "band length (cm)", yLabel: "force (N)" });

  function renderCalibration() {
    const body = $("calib-table").tBodies[0];
    state.calibration.forEach((row) => {
      const cell = body.querySelector('tr[data-id="' + row.id + '"] [data-cell="force"]');
      if (cell) cell.textContent = Number.isFinite(row.massG) ? ((row.massG / 1000) * G).toFixed(2) : "–";
    });

    const pts = calibrationPoints();
    const fit = Analysis.fitBand(pts);
    const box = $("calib-result");
    if (!fit) {
      box.replaceChildren(
        el("p", {}, pts.length < 2 ? "Enter at least two weights with their band lengths to estimate k." : "These points do not give a stretchy band: check the numbers.")
      );
    } else {
      const quality = fit.r2 > 0.98 ? "a very straight line" : fit.r2 > 0.9 ? "a reasonable line" : "not a straight line: rubber is not a perfect spring";
      const same = Math.abs(fit.k - state.catapult.bandK) < 0.05 && Math.abs(fit.l0 - state.catapult.bandL0) < 5e-4;
      box.replaceChildren(
        el("p", {}, "One band: ", el("strong", {}, "k = " + fit.k.toFixed(1) + " N/m"), ", rest length ", el("strong", {}, (fit.l0 * 100).toFixed(1) + " cm"), "."),
        el("p", { class: "help" }, "Fit quality R² = " + fit.r2.toFixed(3) + " (" + quality + "). Solid line: this fit. Dashed line: the values the model uses now."),
        el(
          "button",
          {
            type: "button",
            class: "primary",
            disabled: same,
            onclick: () => {
              state.catapult.bandK = fit.k;
              state.catapult.bandL0 = Math.max(fit.l0, 0);
              buildCatapultForm();
              scheduleRender();
            },
          },
          same ? "Used in the model ✓" : "Use these values in the model"
        )
      );
    }

    if ($("pane-catapult").hidden) return; // canvas has no size while the tab is hidden
    const xs = pts.map((p) => cm(p.lengthM));
    const ys = pts.map((p) => p.forceN);
    const xLo = Math.min(...xs, fit ? cm(fit.l0) : Infinity, cm(state.catapult.bandL0));
    const xHi = Math.max(...xs, xLo + 1);
    const pad = (xHi - xLo) * 0.1 + 0.5;
    const x0 = Math.max(0, xLo - pad);
    const x1 = xHi + pad;
    // A band pulls only when stretched: zero force up to its rest length, then a straight line.
    const line = (k, l0) => [x0, clamp(cm(l0), x0, x1), x1].map((x) => [x, Math.max(0, k * (x / 100 - l0))]);
    calibPlot.draw({
      x: [x0, x1],
      y: [0, Math.max(0.5, ...ys) * 1.15],
      series: [
        { type: "line", points: line(state.catapult.bandK, state.catapult.bandL0), color: css("--muted"), width: 1.5, dash: [5, 4] },
        fit ? { type: "line", points: line(fit.k, fit.l0), color: css("--model"), width: 2.5 } : null,
        { type: "points", points: pts.map((p) => ({ x: cm(p.lengthM), y: p.forceN })), color: css("--data") },
      ].filter(Boolean),
    });
  }

  /* ------------------------------------------------------------------ */
  /* Shots table                                                        */
  /* ------------------------------------------------------------------ */

  /** "123, 118 121.5" -> [123, 118, 121.5]; null if anything is not a number. */
  function parseShots(text) {
    const parts = text.split(/[\s,;]+/).filter(Boolean);
    const values = parts.map(Number);
    return values.every((v) => Number.isFinite(v) && v >= 0) ? values : null;
  }

  function rebuildMeasureTable() {
    const body = $("measure-table").tBodies[0];
    if (!state.measurements.length) {
      body.replaceChildren(el("tr", {}, el("td", { colSpan: 10, class: "empty" }, "No shots yet.")));
      return;
    }
    body.replaceChildren(
      ...state.measurements.map((m, i) => {
        const shots = el("input", {
          type: "text",
          class: "shots",
          inputMode: "decimal",
          value: m.distancesCm.join(", "),
          placeholder: "e.g. 85, 91, 88",
          "aria-label": "Shots in cm for row " + (i + 1),
          oninput: () => {
            const v = parseShots(shots.value);
            shots.classList.toggle("invalid", v === null);
            if (v) {
              m.distancesCm = v;
              scheduleRender();
            }
          },
        });
        return el(
          "tr",
          { "data-id": m.id },
          el("td", {}, String(i + 1)),
          el("td", {}, String(m.bands)),
          el("td", {}, fmtDeg(m.pullBackDeg)),
          el("td", {}, fmtDeg(m.stopDeg)),
          el("td", {}, shots),
          el("td", { "data-cell": "stats" }),
          el("td", { "data-cell": "range" }),
          el("td", { "data-cell": "model" }),
          el("td", { "data-cell": "residual" }),
          el(
            "td",
            {},
            el("button", { type: "button", class: "icon-btn", title: "Use these settings", onclick: () => applySettings(m) }, "Use"),
            " ",
            el(
              "button",
              {
                type: "button",
                class: "icon-btn",
                title: "Delete row",
                "aria-label": "Delete row " + (i + 1),
                onclick: () => {
                  state.measurements = state.measurements.filter((x) => x !== m);
                  rebuildMeasureTable();
                  scheduleRender();
                },
              },
              "✕"
            )
          )
        );
      })
    );
  }

  function updateMeasureCells(comparison) {
    const body = $("measure-table").tBodies[0];
    comparison.rows.forEach(({ row, stats, predicted, residual }) => {
      const tr = body.querySelector('tr[data-id="' + row.id + '"]');
      if (!tr) return;
      const cell = (name) => tr.querySelector('[data-cell="' + name + '"]');
      if (!stats) {
        cell("stats").replaceChildren("–");
        cell("range").replaceChildren("–");
      } else if (stats.n === 1) {
        cell("stats").replaceChildren(fmtCm(stats.mean), " ", el("span", { class: "muted" }, "(shoot again to see the spread)"));
        cell("range").replaceChildren("–");
      } else {
        cell("stats").replaceChildren(
          el("strong", {}, fmtCm(stats.mean)),
          " ± " + fmtSpreadCm(stats.std) + " ",
          el("span", { class: "muted" }, "(" + stats.n + " shots)")
        );
        cell("range").replaceChildren(Math.round(cm(stats.min)) + " – " + Math.round(cm(stats.max)) + " cm");
      }
      cell("model").textContent = fmtCm(predicted);
      cell("residual").textContent = residual === null ? "–" : (residual > 0 ? "+" : "") + fmtCm(residual);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Prediction                                                         */
  /* ------------------------------------------------------------------ */

  /** Pull-back angle that hits the target with the current bands and stop angle. */
  function solvePrediction(targetCm) {
    const r = settingRange("pullBackDeg");
    const base = paramsFor(state.settings);
    const sol = Model.solveSetting(base, "thetaI", targetCm / 100, rad(Math.max(r.min, state.settings.stopDeg)), rad(r.max));
    const settings = Object.assign({}, state.settings, { pullBackDeg: snap("pullBackDeg", deg(sol.value)) });
    return { ok: sol.ok, reason: sol.reason, settings: settings, landing: Model.range(paramsFor(settings)) };
  }

  function buildTargetButtons() {
    $("target-buttons").replaceChildren(
      ...CFG.predict.targetsCm.map((t) =>
        el(
          "button",
          {
            type: "button",
            "data-target": t,
            onclick: () => {
              state.targetCm = t;
              $("target-cm").value = t;
              scheduleRender();
            },
          },
          t + " cm"
        )
      )
    );
  }

  function renderPrediction() {
    document.querySelectorAll("#target-buttons button").forEach((b) => {
      b.setAttribute("aria-pressed", String(Number(b.dataset.target) === state.targetCm));
    });
    const box = $("prediction");
    if (!(state.targetCm > 0)) {
      box.replaceChildren();
      return;
    }
    const p = solvePrediction(state.targetCm);
    const parts = [];
    if (!p.ok) {
      parts.push(
        el(
          "p",
          { class: "warn" },
          p.reason === "too-far"
            ? "The model says this target is too far with these settings. Try more bands or another stop angle."
            : "The model says this target is too close with these settings. Try fewer bands or another stop angle."
        )
      );
    }
    parts.push(
      el(
        "p",
        {},
        "To hit ",
        el("strong", {}, state.targetCm + " cm"),
        " with ",
        el("strong", {}, fmtBands(state.settings.bands)),
        " and stop angle ",
        el("strong", {}, fmtDeg(state.settings.stopDeg)),
        ", pull back to:"
      ),
      el("p", { class: "big" }, fmtDeg(p.settings.pullBackDeg)),
      el("p", {}, "With that setting the model expects the ball at ", el("strong", {}, fmtCm(p.landing)), ".")
    );
    const isSet = close(state.settings.pullBackDeg, p.settings.pullBackDeg);
    parts.push(
      el(
        "div",
        { class: "actions" },
        el("button", { type: "button", disabled: isSet, onclick: () => applySettings(p.settings) }, isSet ? "Catapult set ✓" : "Set the catapult to this"),
        el(
          "button",
          {
            type: "button",
            class: "primary",
            onclick: () => {
              state.predictions.push(
                Object.assign({ id: newId(), targetCm: state.targetCm, predictedCm: Math.round(cm(p.landing)), actualCm: null }, p.settings)
              );
              rebuildPredictTable();
              scheduleRender();
            },
          },
          "Lock in prediction"
        )
      )
    );
    box.replaceChildren(...parts);
  }

  function rebuildPredictTable() {
    const body = $("predict-table").tBodies[0];
    if (!state.predictions.length) {
      body.replaceChildren(el("tr", {}, el("td", { colSpan: 8, class: "empty" }, "No predictions locked in yet.")));
      return;
    }
    body.replaceChildren(
      ...state.predictions.map((p, i) => {
        const actual = el("input", {
          type: "number",
          min: "0",
          step: "any",
          inputMode: "decimal",
          value: p.actualCm === null ? "" : p.actualCm,
          "aria-label": "Real landing distance in cm for prediction " + (i + 1),
          oninput: () => {
            const v = actual.value === "" ? null : Number(actual.value);
            p.actualCm = Number.isFinite(v) ? v : null;
            scheduleRender();
          },
        });
        return el(
          "tr",
          { "data-id": p.id },
          el("td", {}, String(i + 1)),
          el("td", {}, p.targetCm + " cm"),
          el("td", {}, settingText(p)),
          el("td", {}, p.predictedCm + " cm"),
          el("td", {}, actual),
          el("td", { "data-cell": "miss" }),
          el("td", { "data-cell": "points" }),
          el(
            "td",
            {},
            el(
              "button",
              {
                type: "button",
                class: "icon-btn",
                "aria-label": "Delete prediction " + (i + 1),
                onclick: () => {
                  state.predictions = state.predictions.filter((x) => x !== p);
                  rebuildPredictTable();
                  scheduleRender();
                },
              },
              "✕"
            )
          )
        );
      })
    );
  }

  function updatePredictCells() {
    const body = $("predict-table").tBodies[0];
    let total = 0;
    state.predictions.forEach((p) => {
      const tr = body.querySelector('tr[data-id="' + p.id + '"]');
      if (!tr) return;
      const missCell = tr.querySelector('[data-cell="miss"]');
      const pointsCell = tr.querySelector('[data-cell="points"]');
      if (p.actualCm === null) {
        missCell.textContent = "–";
        pointsCell.textContent = "–";
        pointsCell.className = "";
        return;
      }
      const miss = (p.actualCm - p.targetCm) / 100;
      const points = Analysis.scoreShot(miss, CFG.predict.scoring);
      total += points;
      missCell.textContent = (miss > 0 ? "+" : "") + fmtCm(miss);
      pointsCell.textContent = String(points);
      pointsCell.className = points === CFG.predict.scoring.maxPoints ? "points-10" : "";
    });
    $("total-points").textContent = String(total);
  }

  /* ------------------------------------------------------------------ */
  /* Drawing                                                            */
  /* ------------------------------------------------------------------ */

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /** Catapult geometry in metres for arm angle theta (origin on the floor below the pivot). */
  function catapultShape(p, theta) {
    const s = Math.sin(theta);
    const c = Math.cos(theta);
    return {
      pivot: [0, p.pivotHeight],
      cup: [-p.lLeft * s, p.pivotHeight + p.lLeft * c],
      armEnd: [p.lRight * s, p.pivotHeight - p.lRight * c],
      anchor: [0, p.pivotHeight - p.lFoot],
    };
  }

  /** Draw the catapult with a toPx(x, y) mapping; `scale` = px per metre. */
  function drawCatapult(ctx, toPx, scale, p, opts) {
    const line = (a, b, color, width, dash) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      ctx.moveTo(...toPx(a[0], a[1]));
      ctx.lineTo(...toPx(b[0], b[1]));
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const ink = css("--plot-ink");
    const fin = catapultShape(p, p.thetaF);
    const ini = catapultShape(p, p.thetaI);
    const ballR = Math.max(0.01 * scale, 3);
    // Base and foot.
    line([-0.03, 0], [0.04, 0], ink, 3);
    line([0, 0], fin.pivot, ink, 3);
    if (opts.showPullBack) {
      line(ini.cup, ini.armEnd, css("--muted"), 2, [5, 4]);
      line(ini.anchor, ini.armEnd, css("--data"), 1.5, [2, 3]);
      const [bx, by] = toPx(ini.cup[0], ini.cup[1]);
      ctx.fillStyle = css("--muted");
      ctx.beginPath();
      ctx.arc(bx, by, ballR, 0, 2 * Math.PI);
      ctx.fill();
    }
    line(fin.anchor, fin.armEnd, css("--data"), 2);
    line(fin.cup, fin.armEnd, ink, 4);
    const [px, py] = toPx(fin.pivot[0], fin.pivot[1]);
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, 2 * Math.PI);
    ctx.fill();
  }

  /** Small legend in the sketch's top-left corner. */
  function drawSketchLegend(ctx, p, bands) {
    const rows = [
      [css("--muted"), [5, 4], "pull-back " + fmtDeg(deg(p.thetaI))],
      [css("--plot-ink"), [], "stop " + fmtDeg(deg(p.thetaF))],
      [css("--data"), [], fmtBands(bands)],
    ];
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    rows.forEach(([color, dash, text], i) => {
      const y = 12 + i * 16;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(8, y);
      ctx.lineTo(26, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = css("--plot-ink");
      ctx.fillText(text, 31, y);
    });
  }

  function drawSketch(p) {
    const canvas = $("catapult-sketch");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // Zoom in on the arm: centre the pivot, leave room for the legend at the top.
    const reach = Math.max(p.lLeft, p.lRight, p.lFoot) + 0.008;
    const legendH = 52;
    const scale = Math.min((w - 16) / (2 * reach), (h - legendH - 8) / (2 * reach));
    const ox = w / 2;
    const oy = legendH + reach * scale; // pixel row of the pivot
    const toPx = (x, y) => [ox + x * scale, oy - (y - p.pivotHeight) * scale];
    drawCatapult(ctx, toPx, scale, p, { showPullBack: true });
    drawSketchLegend(ctx, p, state.settings.bands);
  }

  const trajPlot = new MiniPlot($("traj-plot"), { xLabel: "distance from catapult (m)", yLabel: "height (m)" });
  const rangePlot = new MiniPlot($("range-plot"), { xLabel: "pull-back angle (°)", yLabel: "landing distance (m)" });
  const X_LABELS = { pullBackDeg: "pull-back angle (°)", stopDeg: "stop angle (°)", bands: "number of elastic bands" };

  function drawTrajectory(p, sim) {
    const shots = [];
    state.measurements.forEach((m) => {
      if (sameSettings(m, state.settings)) m.distancesCm.forEach((d) => shots.push({ x: d / 100, y: 0 }));
    });
    const target = state.tab === "predict" && state.targetCm > 0 ? state.targetCm / 100 : null;
    const far = Math.max(sim.range, target || 0, ...shots.map((s) => s.x), 0.3);
    trajPlot.draw({
      x: [-0.1, far * 1.12],
      y: [0, Math.max(sim.maxHeight, p.pivotHeight + p.lLeft) * 1.15],
      equalAspect: true,
      decorate: (ctx, toPx, scale) => {
        drawCatapult(ctx, toPx, scale, p, { showPullBack: false });
        if (target) {
          const [tx, ty] = toPx(target, 0);
          ctx.strokeStyle = css("--target");
          ctx.fillStyle = css("--target");
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(tx, ty - 34);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(tx, ty - 34);
          ctx.lineTo(tx + 16, ty - 28);
          ctx.lineTo(tx, ty - 22);
          ctx.fill();
        }
      },
      series: [
        { type: "line", points: sim.trajectory || [], color: css("--model"), width: 2.5 },
        { type: "points", points: shots, color: css("--data"), radius: 5 },
      ],
    });
  }

  function drawRangePlot(comparison) {
    const key = state.xAxis;
    const r = settingRange(key);
    rangePlot.labels.xLabel = X_LABELS[key];

    // Bands only come in whole numbers, so the curve is sampled at those.
    const xs = [];
    if (key === "bands") for (let n = r.min; n <= r.max; n++) xs.push(n);
    else for (let i = 0; i <= 80; i++) xs.push(r.min + ((r.max - r.min) * i) / 80);
    const curve = xs.map((v) => [v, Model.range(paramsFor(Object.assign({}, state.settings, { [key]: v })))]);

    const points = comparison.rows
      .filter((c) => c.stats)
      .map(({ row, stats }) => ({
        x: row[key],
        y: stats.mean,
        lo: stats.min,
        hi: stats.max,
        faded: !sameSettings(row, state.settings, key),
      }));
    const yMax = Math.max(0.2, ...curve.map((c) => c[1]), ...points.map((pt) => pt.hi)) * 1.1;
    const pad = key === "bands" ? 0.3 : 0;
    const current = state.settings[key];
    rangePlot.draw({
      x: [r.min - pad, r.max + pad],
      y: [0, yMax],
      decorate: (ctx, toPx) => {
        const [cx] = toPx(current, 0);
        ctx.strokeStyle = css("--muted");
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, 10000);
        ctx.stroke();
        ctx.setLineDash([]);
        if (state.tab === "predict" && state.targetCm > 0) {
          const [, ty] = toPx(0, state.targetCm / 100);
          ctx.strokeStyle = css("--target");
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(0, ty);
          ctx.lineTo(10000, ty);
          ctx.stroke();
        }
      },
      series: [
        { type: "line", points: curve, color: css("--model"), width: 2.5 },
        key === "bands" ? { type: "points", points: curve.map(([x, y]) => ({ x, y })), color: css("--model"), radius: 3 } : null,
        { type: "points", points: points, color: css("--data") },
      ].filter(Boolean),
    });
  }

  rangePlot.onClick = (x) => {
    state.settings[state.xAxis] = snap(state.xAxis, x);
    syncControls();
    scheduleRender();
  };

  /* ------------------------------------------------------------------ */
  /* Render loop                                                        */
  /* ------------------------------------------------------------------ */

  function renderFitScore(comparison) {
    const box = $("rms").parentElement;
    box.classList.remove("good", "ok", "bad");
    if (comparison.rms === null) {
      $("rms").textContent = "–";
      $("rms-note").textContent = "add shots to see how good your model is";
      return;
    }
    // Compare the model error with the shot-to-shot spread: that is the best any model can do.
    const spreads = comparison.rows.filter((r) => r.stats && r.stats.n > 1).map((r) => r.stats.std);
    const spread = spreads.length ? Analysis.mean(spreads) : null;
    const rmsCm = cm(comparison.rms);
    const floorCm = Math.max(spread ? cm(spread) : 0, 3);
    box.classList.add(rmsCm <= 1.5 * floorCm ? "good" : rmsCm <= 4 * floorCm ? "ok" : "bad");
    $("rms").textContent = (rmsCm < 10 ? rmsCm.toFixed(1) : Math.round(rmsCm)) + " cm";
    $("rms-note").textContent =
      "average miss (RMS) over " +
      comparison.n +
      (comparison.n === 1 ? " setting" : " settings") +
      (spread ? ". Your own shots spread by about ± " + fmtSpreadCm(spread) + "." : ". Repeat shots to see your spread.");
  }

  function render() {
    const p = paramsFor(state.settings);
    const sim = Model.simulate(p, { trajectory: true });

    $("out-energy").textContent = Math.round(Model.releasedEnergy(p) * 1000) + " mJ";
    $("out-speed").textContent = sim.v0.toFixed(2) + " m/s";
    $("out-range").textContent = sim.ok ? fmtCm(sim.range) : "–";
    $("out-meff").textContent = (Model.effectiveMass(p) * 1000).toFixed(1) + " g";
    $("out-inertia").textContent = (p.inertia * 1e7).toFixed(0) + " g·cm²";

    const comparison = Analysis.compare(
      state.measurements.map((m) => Object.assign({}, m, { distances: m.distancesCm.map((d) => d / 100) })),
      (row) => Model.range(paramsFor(row))
    );
    renderFitScore(comparison);
    updateMeasureCells(comparison);
    renderPrediction();
    updatePredictCells();
    renderCalibration();

    drawSketch(p);
    drawTrajectory(p, sim);
    drawRangePlot(comparison);

    Storage.save(state);
  }

  let pending = false;
  function scheduleRender() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      syncControls();
      render();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Page wiring                                                        */
  /* ------------------------------------------------------------------ */

  function selectTab(name) {
    state.tab = name;
    TABS.forEach((t) => {
      $("tab-" + t).setAttribute("aria-selected", String(t === name));
      $("pane-" + t).hidden = t !== name;
    });
    scheduleRender();
  }

  function rebuildAll() {
    buildSettingsControls();
    buildFitControls();
    buildCatapultForm();
    buildTargetButtons();
    rebuildCalibrationTable();
    rebuildMeasureTable();
    rebuildPredictTable();
    refreshLimits();
    $("target-cm").value = state.targetCm || "";
    selectTab(state.tab);
  }

  function init() {
    document.title = CFG.title;
    $("app-title").textContent = CFG.title;
    if (CFG.scoreboardUrl) {
      $("scoreboard-link").href = CFG.scoreboardUrl;
      $("scoreboard-link").hidden = false;
    }

    $("team-name").addEventListener("input", (ev) => {
      state.team = ev.target.value;
      scheduleRender();
    });
    $("x-axis").addEventListener("change", (ev) => {
      state.xAxis = ev.target.value;
      scheduleRender();
    });
    TABS.forEach((t) => $("tab-" + t).addEventListener("click", () => selectTab(t)));
    $("goto-catapult").addEventListener("click", () => {
      selectTab("catapult");
      $("tab-catapult").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("target-cm").addEventListener("input", (ev) => {
      const v = Number(ev.target.value);
      state.targetCm = ev.target.value !== "" && v > 0 ? v : null;
      scheduleRender();
    });
    $("add-measurement").addEventListener("click", () => {
      state.measurements.push(Object.assign({ id: newId(), distancesCm: [] }, state.settings));
      rebuildMeasureTable();
      scheduleRender();
      const inputs = document.querySelectorAll("#measure-table input.shots");
      if (inputs.length) inputs[inputs.length - 1].focus();
    });
    $("add-calib").addEventListener("click", () => {
      state.calibration.push({ id: newId(), massG: null, lengthCm: null });
      rebuildCalibrationTable();
      scheduleRender();
      const inputs = document.querySelectorAll("#calib-table input");
      if (inputs.length) inputs[inputs.length - 2].focus();
    });
    $("catapult-reset").addEventListener("click", () => {
      state.catapult = Object.assign({}, CFG.catapult);
      buildCatapultForm();
      refreshLimits();
      scheduleRender();
    });
    $("share-btn").addEventListener("click", () => {
      const url = location.href.split("#")[0] + Storage.encodeHash(state);
      history.replaceState(null, "", url);
      $("share-box").hidden = false;
      $("share-url").value = url;
      $("share-url").select();
      // Clipboard needs a secure context (https or localhost); the text box is the fallback.
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).catch(() => {});
    });
    $("reset-btn").addEventListener("click", () => {
      if (!window.confirm("Delete all measurements and predictions on this device and start over?")) return;
      Storage.clear();
      history.replaceState(null, "", location.href.split("#")[0]);
      state = defaultState();
      rebuildAll();
    });

    rebuildAll();
  }

  init();
})();
