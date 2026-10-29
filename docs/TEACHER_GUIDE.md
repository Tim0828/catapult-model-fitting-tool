# Teacher guide

## Before the lesson: configure the tool

Everything lesson-specific is in [`web/js/config.js`](../web/js/config.js).

### 1. Starting values for the catapult

The `catapult` block holds the **starting values** students see in the *Catapult & bands* tab. Students can
re-measure and correct every one of them.

| Setting | What it is | Students measure it with |
|---|---|---|
| `lLeft` | pivot axis → centre of the ball cup | ruler |
| `lRight` | pivot axis → band hook on the arm | ruler |
| `lFoot` | pivot axis → band hook on the foot | ruler |
| `pivotHeight` | pivot axis → table or floor where the ball lands | ruler |
| `ballMass` | the ball | kitchen or letter scales |
| `armMass` | the printed arm (treated as a uniform rod) | scales |
| `cupMass` | a separate cup at the end of the arm (0 if weighed with the arm) | scales |
| `bandK`, `bandL0` | stiffness and rest length of **one** elastic band | hanging-weight test (below) |

The tool computes the arm's moment of inertia from the arm and cup masses.

**Make it a challenge:** enter starting values that are a little off, for example a band stiffness 30% too high or
a pivot height that is 2 cm wrong. Teams that check their catapult first will get a better model, and you can
discuss why the starting model did not fit.

### 2. Elastic bands

Students choose 1–6 bands (`bands: { min, max, default }`). Identical bands side by side add their stiffness, so
the model uses K = number of bands × k of one band. The band count is stored with every shot.

**Hanging-weight test (in the tool):** hang one band from a hook, hang several known weights from it (for example
0, 50, 100, 200 g), and measure the band length each time. Enter the masses and lengths in the *Catapult & bands*
tab. The tool fits Hooke's law F = k · (L − L0) and shows k, the rest length L0 and R² (how straight the line is).
*Use these values in the model* copies them into the measurements.

Tips:
* Use the same kind of band and the same way of hooking it as on the catapult.
* Rubber stiffens at large stretch and behaves differently when loading and unloading. That is a good discussion
  point, and the reason R² is shown.
* The rest length is where the band just stops being slack between the hooks, so it is not the band's
  circumference.

### 3. Decide what students control

This was the open question in the review. Recommendation:

* **Stop angle:** a few fixed notches (`notchesDeg`). Notches are easy to print and to reproduce.
* **Number of bands:** 1–6. This gives a coarse range choice.
* **Pull-back angle:** the fine control. A printed protractor scale on the side of the catapult works well with a
  continuous slider (`stepDeg: 1`). If your design has a ratchet, list its positions in `notchesDeg` instead.

Then check that every target in `predict.targetsCm` can be reached. Open the tool, enter realistic band values,
set the efficiency to about 50–70%, and look at the "Distance vs ..." plot (it can show pull-back angle, stop angle
or number of bands on the horizontal axis).

### 4. Optional: hide sliders

Set `show: false` on a fit parameter to hide it. For younger students, the efficiency slider alone makes a complete
lesson. Air resistance can be introduced later as "model 2".

## Suggested lesson flow (about 100 minutes)

1. **Introduction (10 min).** Energy in the stretched bands becomes motion of the ball. Show the tool with the
   sketch and the flight path.
2. **Measure the catapult (15 min).** In the *Catapult & bands* tab, teams check the lengths and masses and do the
   hanging-weight test for one band.
3. **Shoot (25 min).** Each team picks 3–4 settings (vary bands and pull-back). They shoot 3–5 times per setting and
   type every landing distance in the *Shots* tab. The table shows average ± spread and shortest–longest shot. Talk
   about the spread: why doesn't the ball land in the same place every time?
4. **Fit (15 min).** Teams move the sliders until the *model error* is as small as possible. Ask: can the model be
   better than your own spread? What happens if the band stiffness is wrong: can the efficiency slider hide that?
5. **Model 2 (optional, 10 min).** Switch on air resistance. Does the error go down? Is it worth the extra knob?
6. **Prediction rounds (20 min).** The referee announces a target. Teams use *Predict & score* to find the
   pull-back angle for their chosen number of bands and stop angle, and lock in their prediction *before* shooting.
   The referee enters the landing distance on the scoreboard. Scoring: 10 points within 5 cm, one point less for
   every extra 5 cm.
7. **Wrap-up (5 min).** Every model is a simplification. What did the model leave out? Possible answers: friction,
   arm flex, gravity during the swing, air, the bands' own mass, and rubber not behaving like a perfect spring.

## During the lesson

* Students' data is stored on their own device. *Share / save link* puts all of a team's data in a URL, which they
  can bookmark or send to a teammate on another device. This includes their catapult measurements and band test.
* *Start over* clears the device after a confirmation prompt.
* *Restore starting values* in the *Catapult & bands* tab resets the measurements to the values in `config.js`.
