/**
 * Catapult Challenge app: wires the model, analysis, storage and plots to the page.
 *
 * Data flow: every user action updates `state` and calls `scheduleRender()`.
 * `render()` recomputes everything from `state` (it is cheap) and saves it.
 * Tables are rebuilt only when rows are added or removed, so typing in a
 * table input never loses focus; their computed cells are refreshed in place.
 */
(function () {
  "use strict";

  const CFG = window.CATAPULT_CONFIG;
  const Model = window.CatapultModel;
  const Analysis = window.CatapultAnalysis;
  const Storage = window.CatapultStorage;
  const MiniPlot = window.MiniPlot;

  const $ = (id) => document.getElementById(id);
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const cm = (m) => m * 100;
  const fmtCm = (m) => (Number.isFinite(m) ? Math.round(cm(m)) + " cm" : "–");
  const fmtDeg = (d) => Math.round(d * 10) / 10 + "°";
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

  function defaultState() {
    return {
      team: "",
      settings: {
        springId: SET.defaultSpring || CFG.springs[0].id,
        pullBackDeg: SET.pullBack.defaultDeg,
        stopDeg: SET.stopAngle.defaultDeg,
      },
      fit: {
        efficiency: FIT.efficiency.initial,
        dragModel: FIT.drag.initialModel,
        dragQuadratic: FIT.drag.quadratic.initial, // g/m
        dragLinear: FIT.drag.linear.initial, // mN s/m
        releaseOffsetDeg: FIT.releaseOffset.initial,
      },
      overrides: { catapult: {}, springs: {} },
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
    const springIds = CFG.springs.map((x) => x.id);
    const springId = (v) => (springIds.includes(v) ? v : s.settings.springId);
    const settingsOf = (o) => ({
      springId: springId(o && o.springId),
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
    const o = raw.overrides || {};
    Object.keys(CFG.catapult).forEach((k) => {
      if (o.catapult && Number.isFinite(o.catapult[k])) s.overrides.catapult[k] = o.catapult[k];
    });
    springIds.forEach((id) => {
      const so = o.springs && o.springs[id];
      if (!so) return;
      const clean = {};
      if (Number.isFinite(so.k)) clean.k = so.k;
      if (Number.isFinite(so.l0)) clean.l0 = so.l0;
      s.overrides.springs[id] = clean;
    });
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
    s.xAxis = raw.xAxis === "stopDeg" ? "stopDeg" : "pullBackDeg";
    s.targetCm = Number.isFinite(raw.targetCm) ? raw.targetCm : null;
    s.tab = raw.tab === "predict" ? "predict" : "measure";
    return s;
  }

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

  function catapult() {
    return Object.assign({}, CFG.catapult, state.overrides.catapult);
  }

  function springList() {
    return CFG.springs.map((s) => Object.assign({}, s, state.overrides.springs[s.id]));
  }

  function springById(id) {
    const list = springList();
    return list.find((s) => s.id === id) || list[0];
  }

  /** Full model parameters for a set of catapult settings and the current fit. */
  function paramsFor(settings) {
    const spring = springById(settings.springId);
    const f = state.fit;
    let drag = 0;
    if (f.dragModel === "quadratic") drag = f.dragQuadratic / 1000; // g/m -> kg/m
    else if (f.dragModel === "linear") drag = f.dragLinear / 1000; // mN s/m -> N s/m
    return Object.assign({}, Model.DEFAULT_PARAMS, catapult(), {
      k: spring.k,
      l0: spring.l0 || 0,
      thetaI: rad(settings.pullBackDeg),
      thetaF: rad(settings.stopDeg),
      efficiency: f.efficiency,
      dragModel: f.dragModel,
      drag: drag,
      releaseOffset: rad(f.releaseOffsetDeg),
    });
  }

  function pullBackRange() {
    const c = SET.pullBack;
    const geomMax = Math.floor(deg(Model.maxPullBack(catapult())));
    return { min: c.minDeg, max: Math.min(c.maxDeg === null ? geomMax : c.maxDeg, geomMax), step: c.stepDeg };
  }

  function stopRange() {
    const c = SET.stopAngle;
    return { min: c.minDeg, max: c.maxDeg, step: c.stepDeg };
  }

  /** Snap a setting to what the real catapult allows (a notch or a slider step). */
  function snap(key, value) {
    const c = key === "pullBackDeg" ? SET.pullBack : SET.stopAngle;
    const r = key === "pullBackDeg" ? pullBackRange() : stopRange();
    if (c.notchesDeg && c.notchesDeg.length) {
      return c.notchesDeg.reduce((best, n) => (Math.abs(n - value) < Math.abs(best - value) ? n : best));
    }
    return clamp(Math.round(value / r.step) * r.step, r.min, r.max);
  }

  const sameSetting = (a, b) => Math.abs(a - b) < 0.25;

  /* ------------------------------------------------------------------ */
  /* Controls                                                           */
  /* ------------------------------------------------------------------ */

  const controls = {}; // key -> {set(value)} to push state back into inputs

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

  function angleControl(key, cfg, range, label, help) {
    const notches = cfg.notchesDeg && cfg.notchesDeg.length ? cfg.notchesDeg : null;
    return makeControl({
      key: key,
      label: label,
      help: help,
      min: range.min,
      max: range.max,
      step: range.step,
      options: notches ? notches.map((n) => ({ value: n, text: n + "°" })) : null,
      format: fmtDeg,
      get: () => state.settings[key],
      set: (v) => (state.settings[key] = v),
    });
  }

  function buildSettingsControls() {
    const box = $("settings-controls");
    box.replaceChildren(
      makeControl({
        key: "springId",
        label: "Spring",
        options: springList().map((s) => ({ value: s.id, text: s.name })),
        get: () => state.settings.springId,
        set: (v) => (state.settings.springId = v),
      }),
      angleControl("pullBackDeg", SET.pullBack, pullBackRange(), "Pull-back angle", "How far you pull the arm back."),
      angleControl("stopDeg", SET.stopAngle, stopRange(), "Stop angle", "Where the arm hits the stop. This is also the launch angle.")
    );
  }

  function buildFitControls() {
    const box = $("fit-controls");
    const items = [];
    if (FIT.efficiency.show) {
      items.push(
        makeControl({
          key: "efficiency",
          label: "Efficiency",
          help: "How much of the spring energy ends up in the flying ball. The rest is lost to friction, wobble, sound…",
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
      items.push(
        makeControl({
          key: "dragModel",
          label: "Air resistance",
          options: FIT.drag.models.map((m) => ({ value: m, text: labels[m] })),
          get: () => state.fit.dragModel,
          set: (v) => (state.fit.dragModel = v),
        })
      );
      const q = FIT.drag.quadratic;
      const l = FIT.drag.linear;
      items.push(
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
    box.replaceChildren(...items);
  }

  /** Teacher panel: physical constants, in friendly units. */
  function buildTeacherControls() {
    const fields = [
      ["lLeft", "Arm to cup (cm)", 100],
      ["lRight", "Arm to spring (cm)", 100],
      ["lFoot", "Pivot to spring anchor (cm)", 100],
      ["pivotHeight", "Pivot height (cm)", 100],
      ["mass", "Ball mass (g)", 1000],
      ["inertia", "Arm inertia (g·cm²)", 1e7],
    ];
    const inputs = fields.map(([key, label, scale]) =>
      el(
        "label",
        {},
        label,
        el("input", {
          type: "number",
          step: "any",
          min: "0",
          value: +(catapult()[key] * scale).toPrecision(4),
          onchange: (ev) => {
            const v = Number(ev.target.value) / scale;
            if (Number.isFinite(v) && v > 0) state.overrides.catapult[key] = v;
            else ev.target.value = +(catapult()[key] * scale).toPrecision(4);
            refreshLimits();
            scheduleRender();
          },
        })
      )
    );
    springList().forEach((s) => {
      [
        ["k", s.name + ": k (N/m)", 1],
        ["l0", s.name + ": rest length (cm)", 100],
      ].forEach(([key, label, scale]) => {
        inputs.push(
          el(
            "label",
            {},
            label,
            el("input", {
              type: "number",
              step: "any",
              min: "0",
              value: +((s[key] || 0) * scale).toPrecision(4),
              onchange: (ev) => {
                const v = Number(ev.target.value) / scale;
                if (Number.isFinite(v) && v >= 0) {
                  state.overrides.springs[s.id] = Object.assign({}, state.overrides.springs[s.id], { [key]: v });
                }
                scheduleRender();
              },
            })
          )
        );
      });
    });
    $("teacher-controls").replaceChildren(...inputs);
  }

  function refreshLimits() {
    const r = pullBackRange();
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

  /* ------------------------------------------------------------------ */
  /* Measurements table                                                 */
  /* ------------------------------------------------------------------ */

  /** "123, 118 121.5" -> [123, 118, 121.5]; null if anything is not a number. */
  function parseShots(text) {
    const parts = text.split(/[\s,;]+/).filter(Boolean);
    const values = parts.map(Number);
    return values.every((v) => Number.isFinite(v) && v >= 0) ? values : null;
  }

  function settingText(s) {
    return springById(s.springId).name + ", " + fmtDeg(s.pullBackDeg) + " / " + fmtDeg(s.stopDeg);
  }

  function applySettings(s) {
    state.settings = { springId: s.springId, pullBackDeg: s.pullBackDeg, stopDeg: s.stopDeg };
    syncControls();
    scheduleRender();
  }

  function rebuildMeasureTable() {
    const body = $("measure-table").tBodies[0];
    if (!state.measurements.length) {
      body.replaceChildren(el("tr", {}, el("td", { colSpan: 9, class: "empty" }, "No measurements yet.")));
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
          el("td", {}, springById(m.springId).name),
          el("td", {}, fmtDeg(m.pullBackDeg)),
          el("td", {}, fmtDeg(m.stopDeg)),
          el("td", {}, shots),
          el("td", { "data-cell": "stats" }),
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
      cell("stats").textContent = stats
        ? fmtCm(stats.mean) + (stats.n > 1 ? " ± " + Math.round(cm(stats.std)) + " (n=" + stats.n + ")" : "")
        : "–";
      cell("model").textContent = fmtCm(predicted);
      cell("residual").textContent = residual === null ? "–" : (residual > 0 ? "+" : "") + fmtCm(residual);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Prediction                                                         */
  /* ------------------------------------------------------------------ */

  /** Pull-back angle that hits the target with the current spring and stop angle. */
  function solvePrediction(targetCm) {
    const r = pullBackRange();
    const base = paramsFor(state.settings);
    const sol = Model.solveSetting(base, "thetaI", targetCm / 100, rad(Math.max(r.min, state.settings.stopDeg)), rad(r.max));
    const pullBackDeg = snap("pullBackDeg", deg(sol.value));
    const settings = Object.assign({}, state.settings, { pullBackDeg: pullBackDeg });
    return { ok: sol.ok, reason: sol.reason, exactDeg: deg(sol.value), settings: settings, landing: Model.range(paramsFor(settings)) };
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
    const spring = springById(state.settings.springId).name;
    const parts = [];
    if (!p.ok) {
      parts.push(
        el(
          "p",
          { class: "warn" },
          p.reason === "too-far"
            ? "The model says this target is too far with this spring and stop angle. Try a stiffer spring or another stop angle."
            : "The model says this target is too close with this spring and stop angle. Try a softer spring or another stop angle."
        )
      );
    }
    parts.push(
      el("p", {}, "To hit ", el("strong", {}, state.targetCm + " cm"), " with spring ", el("strong", {}, spring), " and stop angle ", el("strong", {}, fmtDeg(state.settings.stopDeg)), ", pull back to:"),
      el("p", { class: "big" }, fmtDeg(p.settings.pullBackDeg)),
      el("p", {}, "With that setting the model expects the ball at ", el("strong", {}, fmtCm(p.landing)), ".")
    );
    const isSet = sameSetting(state.settings.pullBackDeg, p.settings.pullBackDeg);
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

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  /** Catapult geometry in metres for arm angle theta (origin on the floor below the pivot). */
  function catapultShape(p, theta) {
    const pivot = [0, p.pivotHeight];
    const s = Math.sin(theta);
    const c = Math.cos(theta);
    return {
      pivot: pivot,
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
  function drawSketchLegend(ctx, p) {
    const rows = [
      [css("--muted"), [5, 4], "pull-back " + fmtDeg(deg(p.thetaI))],
      [css("--plot-ink"), [], "stop " + fmtDeg(deg(p.thetaF))],
      [css("--data"), [], "spring"],
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
    drawSketchLegend(ctx, p);
  }

  const trajPlot = new MiniPlot($("traj-plot"), { xLabel: "distance from catapult (m)", yLabel: "height (m)" });
  const rangePlot = new MiniPlot($("range-plot"), { xLabel: "pull-back angle (°)", yLabel: "landing distance (m)" });

  function drawTrajectory(p, sim) {
    const shots = [];
    state.measurements.forEach((m) => {
      if (m.springId === state.settings.springId && sameSetting(m.pullBackDeg, state.settings.pullBackDeg) && sameSetting(m.stopDeg, state.settings.stopDeg)) {
        m.distancesCm.forEach((d) => shots.push({ x: d / 100, y: 0 }));
      }
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
    const other = key === "pullBackDeg" ? "stopDeg" : "pullBackDeg";
    const r = key === "pullBackDeg" ? pullBackRange() : stopRange();
    rangePlot.labels.xLabel = key === "pullBackDeg" ? "pull-back angle (°)" : "stop angle (°)";

    const curve = [];
    const n = 80;
    for (let i = 0; i <= n; i++) {
      const v = r.min + ((r.max - r.min) * i) / n;
      curve.push([v, Model.range(paramsFor(Object.assign({}, state.settings, { [key]: v })))]);
    }
    const points = comparison.rows
      .filter((c) => c.stats)
      .map(({ row, stats }) => ({
        x: row[key],
        y: stats.mean,
        lo: stats.min,
        hi: stats.max,
        faded: !(row.springId === state.settings.springId && sameSetting(row[other], state.settings[other])),
      }));
    const yMax = Math.max(0.2, ...curve.map((c) => c[1]), ...points.map((pt) => pt.hi)) * 1.1;
    const current = state.settings[key];
    rangePlot.draw({
      x: [r.min, r.max],
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
        { type: "points", points: points, color: css("--data") },
      ],
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
      $("rms-note").textContent = "add measurements to see how good your model is";
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
      (spread ? ". Your own shots spread by about ±" + Math.round(cm(spread)) + " cm." : ". Repeat shots to see your spread.");
  }

  function render() {
    const p = paramsFor(state.settings);
    const sim = Model.simulate(p, { trajectory: true });

    $("out-energy").textContent = Math.round(Model.releasedEnergy(p) * 1000) + " mJ";
    $("out-speed").textContent = sim.v0.toFixed(2) + " m/s";
    $("out-range").textContent = sim.ok ? fmtCm(sim.range) : "–";
    $("out-meff").textContent = Math.round(Model.effectiveMass(p) * 1e4) / 10 + " g";

    const comparison = Analysis.compare(
      state.measurements.map((m) => Object.assign({}, m, { distances: m.distancesCm.map((d) => d / 100) })),
      (row) => Model.range(paramsFor(row))
    );
    renderFitScore(comparison);
    updateMeasureCells(comparison);
    renderPrediction();
    updatePredictCells();

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
    ["measure", "predict"].forEach((t) => {
      $("tab-" + t).setAttribute("aria-selected", String(t === name));
      $("pane-" + t).hidden = t !== name;
    });
    scheduleRender();
  }

  function rebuildAll() {
    buildSettingsControls();
    buildFitControls();
    buildTeacherControls();
    buildTargetButtons();
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
    $("tab-measure").addEventListener("click", () => selectTab("measure"));
    $("tab-predict").addEventListener("click", () => selectTab("predict"));
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
    $("share-btn").addEventListener("click", () => {
      const url = location.href.split("#")[0] + Storage.encodeHash(state);
      history.replaceState(null, "", url);
      const box = $("share-box");
      box.hidden = false;
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
    $("teacher-reset").addEventListener("click", () => {
      state.overrides = { catapult: {}, springs: {} };
      buildTeacherControls();
      refreshLimits();
      scheduleRender();
    });

    rebuildAll();
  }

  init();
})();
