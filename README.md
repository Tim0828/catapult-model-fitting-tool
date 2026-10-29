# Catapult Challenge: model-fitting tool

An interactive lesson tool for middle and high school students. Teams build or receive a 3D-printed catapult and
take measurements. They tune a physics model until it matches their shots, then use the model to predict the
setting that hits a target. Predictions are scored, so good modelling beats trial and error.

## Quick start

**Students' tool:** open `web/index.html` in a browser. No build step, no install, no internet needed. It also works
straight from a USB stick (`file://`), from GitHub Pages, or from any static web server:

```sh
cd web
python -m http.server 8000      # then browse to http://localhost:8000
```

**Lesson setup:** edit [`web/js/config.js`](web/js/config.js) with your catapult's dimensions, springs, settings and
targets. See [`docs/TEACHER_GUIDE.md`](docs/TEACHER_GUIDE.md).

**Scoreboard (optional):**

```sh
pip install -r scoreboard/requirements.txt
python scoreboard/app.py        # projector: http://localhost:5000/   referee: http://localhost:5000/referee
```

## Repository layout

```
catapult-tool/
├── web/                    Students' tool (static files only)
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── config.js       Lesson configuration: the one file teachers edit
│   │   ├── model.js        Physics model (pure functions, no DOM)
│   │   ├── analysis.js     Statistics, fit error (RMS), prediction scoring
│   │   ├── storage.js      localStorage + URL-hash persistence
│   │   ├── plot.js         Small canvas plotting helper (no external libraries)
│   │   └── app.js          UI: state, controls, plots, tables, prediction mode
│   └── tests/              Browser test page + fixtures generated from the Python reference
├── reference/              Python reference model, its tests, fixture generator, corrected notebook
├── scoreboard/             Flask + SQLite scoreboard (projector + referee pages) and tests
├── scripts/run_browser_tests.py   Runs the JS tests + app smoke test in headless Chrome/Edge
├── deploy/                 nginx site and systemd unit for a Raspberry Pi
└── docs/                   MODEL.md, HOSTING.md, TEACHER_GUIDE.md
```

## Design decisions

* **Compute in the browser.** The model is a closed-form energy balance plus a 4-variable ODE. That is microseconds
  of work in JS. Sliders respond instantly, the server cannot be overloaded, and the tool works offline.
* **No dependencies, no build.** Plain ES2017 JavaScript in classic `<script>` files, not ES modules. This keeps the
  app working from `file://` (USB stick), where browsers block module scripts. Plotting is a small in-house canvas
  helper instead of uPlot or Plotly, so nothing has to be downloaded or vendored.
* **Pure model code.** `model.js` and `analysis.js` never touch the DOM and use a UMD wrapper. The same files run
  in the app, in the test page and in Node if needed.
* **The Python reference is the source of truth.** It uses `solve_ivp` with tight tolerances and event detection.
  The JS uses RK4 with a bisection root-find on the landing step, and has to match the reference to within 1 µm on
  102 generated cases.
* **Few fit parameters.** Range data only constrain `efficiency × spring energy ÷ effective mass`, so students do
  not tune K, I or m. They get an *efficiency* slider, an optional *air resistance* slider (model v2) and a
  *release angle correction*. The measured constants are in a collapsible teacher panel, which also explains
  the degeneracy.
* **One scoring rule, implemented twice.** It lives in `analysis.js` (students' practice score) and
  `scoring.py` (official scoreboard). Both are tested against the same cases.

## Testing

```sh
pip install -r requirements-dev.txt
python -m pytest                        # reference model + scoreboard (44 tests)
python reference/generate_fixtures.py   # regenerate web/tests/fixtures.js after changing the model
python scripts/run_browser_tests.py     # JS tests vs reference + app smoke test (needs Chrome or Edge)
```

You can also open `web/tests/index.html` directly in any browser to run the JS tests.

Current status: 44/44 Python tests and 115/115 JS tests pass. The app smoke test passes. The UI was checked by
screenshot in light and dark mode at desktop and phone (375 px) width.

When you change the physics, change `reference/catapult_model.py` first, then mirror the change in
`web/js/model.js`, regenerate the fixtures and run both test suites.

## Known limitations and open items

* **Placeholder parameters.** The default dimensions, inertia and spring constants are estimates. Measure the
  printed catapult and the springs before a lesson (see the teacher guide).
* **Controllable settings are still open.** The review asked which values to use for the angle stop, spring
  choice and pull-back. The config supports both notches and continuous sliders. The teacher guide has a
  recommendation, but the final choice depends on the printed design.
* **English UI only.** All text is in `index.html` and `app.js`. A Dutch translation would be a straightforward
  next step.
* **Gravity during the swing and friction in the pivot are not modelled.** They are absorbed into the efficiency.
