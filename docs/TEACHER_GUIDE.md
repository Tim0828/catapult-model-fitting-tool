# Teacher guide

## Before the lesson: configure the tool

Everything lesson-specific is in [`web/js/config.js`](../web/js/config.js).

### 1. Measure the catapult

| Setting | How to measure |
|---|---|
| `lLeft` | pivot axis → centre of the ball cup |
| `lRight` | pivot axis → spring hook on the arm |
| `lFoot` | pivot axis → spring hook on the foot |
| `pivotHeight` | pivot axis → table or floor where the ball lands |
| `mass` | weigh the ball |
| `inertia` | weigh the arm (and cup), then compute it, see below |

For a roughly uniform arm with a cup at the end:

```python
from catapult_model import rod_inertia
rod_inertia(rod_mass=0.010, l_left=0.05, l_right=0.05, cup_mass=0.003)   # kg m^2
```

### 2. Measure the springs or rubber bands

Hang known weights from each spring and measure the length. The slope of force against length is `k` (N/m). The
length where the line crosses zero force is `l0`. Give each spring a colour-coded name in `springs`.

### 3. Decide what students control

This was the open question in the review. Recommendation:

* **Stop angle:** 3–4 fixed notches (for example 15°, 30°, 45°, 60°). Notches are easy to print and to reproduce.
  Use `notchesDeg`.
* **Spring:** 2–3 springs of clearly different stiffness. This gives a coarse range choice.
* **Pull-back angle:** the fine control. A printed protractor scale on the side of the catapult works well with a
  continuous slider (`stepDeg: 1`). If your design has a ratchet, list its positions in `notchesDeg` instead.

Then check that every target in `predict.targetsCm` can be reached. Open the tool, set efficiency to a realistic
value (about 50–70%), and look at the "Distance vs pull-back angle" plot for each spring and stop angle.

### 4. Optional: hide sliders

Set `show: false` on a fit parameter to hide it. For younger students, the efficiency slider alone makes a complete
lesson. Air resistance can be introduced later as "model 2".

## Suggested lesson flow (about 90 minutes)

1. **Introduction (10 min).** Energy in the spring becomes motion of the ball. Show the tool with the sketch and
   the flight path.
2. **Measure (25 min).** Each team picks 3–4 settings. They shoot 3–5 times per setting and type every landing
   distance. Talk about the spread: why doesn't the ball land in the same place every time?
3. **Fit (15 min).** Teams move the sliders until the *model error* is as small as possible. Ask: can the model be
   better than your own spread? Why does a stiffer spring look the same as a higher efficiency? (See the teacher
   panel.)
4. **Model 2 (optional, 10 min).** Switch on air resistance. Does the error go down? Is it worth the extra knob?
5. **Prediction rounds (25 min).** The referee announces a target. Teams use *Predict & score* to find the
   pull-back angle and lock in their prediction *before* shooting. The referee enters the landing distance on the
   scoreboard. Scoring: 10 points within 5 cm, one point less for every extra 5 cm.
6. **Wrap-up (5 min).** Every model is a simplification. What did the model leave out? Possible answers: friction,
   arm flex, gravity during the swing, air, and the spring's own mass.

## During the lesson

* Students' data is stored on their own device. *Share / save link* puts all of a team's data in a URL, which they
  can bookmark or send to a teammate on another device.
* *Start over* clears the device after a confirmation prompt.
* If a device shows odd values, check the teacher panel. Values edited there are saved per device. Use *Restore
  lesson defaults* to undo them.
