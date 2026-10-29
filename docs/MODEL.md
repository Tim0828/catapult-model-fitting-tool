# The catapult model

This document derives the model used by the tool. It also lists how each issue from the model review was fixed.
The reference implementation is [`reference/catapult_model.py`](../reference/catapult_model.py) and the browser port
is [`web/js/model.js`](../web/js/model.js).

## Geometry

The origin is on the landing surface directly below the pivot, with x pointing forward and y up. This matches the
schematic `Ambassador project/drawing.svg`, which was rendered and checked.

| Symbol | Code | Meaning |
|---|---|---|
| $L_\text{left}$ | `l_left` / `lLeft` | pivot → ball cup |
| $L_\text{right}$ | `l_right` / `lRight` | pivot → spring attachment on the arm |
| $L_\text{foot}$ | `l_foot` / `lFoot` | pivot → spring anchor on the foot |
| $h$ | `pivot_height` / `pivotHeight` | pivot above the landing surface |
| $\theta_i$, $\theta_f$ | `theta_i`, `theta_f` | pull-back and stop angle |

Every angle $\theta$ is measured between the foot (pointing down from the pivot) and the spring arm. This is the
same as the angle of the throwing arm from the vertical. The arm swings from $\theta_i$ down to $\theta_f$.

* Ball cup: $(-L_\text{left}\sin\theta,\; h + L_\text{left}\cos\theta)$
* Spring length (law of cosines): $l(\theta)^2 = L_\text{foot}^2 + L_\text{right}^2 - 2L_\text{foot}L_\text{right}\cos\theta$

## Energy balance

Spring energy, where a spring or band with rest length $l_0$ stores nothing when slack:

$$E(\theta) = \tfrac12 K \max(l(\theta) - l_0,\,0)^2,\qquad \Delta E = E(\theta_i) - E(\theta_f)$$

Kinetic energy at release. The arm turns at $\omega$ and the ball moves at $v_0 = \omega L_\text{left}$:

$$\tfrac12 I\omega^2 + \tfrac12 m v_0^2 = \tfrac12\Big(\underbrace{\tfrac{I}{L_\text{left}^2} + m}_{m_\text{eff}}\Big)v_0^2 = \eta\,\Delta E$$

$$v_0 = \sqrt{\frac{2\eta\,\Delta E}{m_\text{eff}}}$$

The efficiency $\eta$ lumps every loss together: pivot friction, arm flex and vibration, the stop impact, and
gravity during the swing.

## Launch

The ball leaves perpendicular to the arm, so its elevation equals $\theta_f$. An optional release-angle correction
$\delta$ models the ball leaving early or the arm flexing. With $\theta_r = \theta_f + \delta$:

$$\vec r_0 = (-L_\text{left}\sin\theta_r,\; h + L_\text{left}\cos\theta_r),\qquad \vec v_0 = v_0(\cos\theta_r,\sin\theta_r)$$

## Flight

$$\dot{\vec r} = \vec v,\qquad m\dot{\vec v} = -m g\,\hat y + \vec F_\text{drag}$$

| Drag model | $\vec F_\text{drag}$ | Coefficient | UI unit |
|---|---|---|---|
| none (model 1) | 0 | – | – |
| quadratic (model 2) | $-c\,\lvert\vec v\rvert\,\vec v$ | $c = \tfrac12\rho C_d A$ [kg/m] | g/m |
| linear | $-b\,\vec v$ | $b$ [N·s/m] | mN·s/m |

The landing point is where $y = 0$.

* **Python:** `solve_ivp` (RK45, rtol 1e-11) with a terminal event at $y=0$.
* **JS:** fixed-step RK4 ($\Delta t$ = 1 ms). When a step crosses $y = 0$, the step size is bisected (60
  iterations), so the landing time is exact to RK4 accuracy. Without drag the closed form is used.

## Fixes relative to the original notebook

| # | Review finding | Fix |
|---|---|---|
| 1 | `I/Lleft*2` should be `I/Lleft**2` | `effective_mass = I / l_left**2 + m`. With the notebook's values $v_0$ goes from 3.07 to 1.07 m/s (test `test_notebook_energy_bug_fixed`). |
| 2 | $I = 10^{-3}$ kg·m² is far too large | Default $1.5\times10^{-5}$ kg·m² (10 g arm and 3 g cup), plus `rod_inertia()` to compute it from the weighed part. |
| 3 | γ labelled N·s/m but used as 1/s | Coefficients are in force units and divided by $m$. Quadratic drag is available as "model 2". |
| 4 | `np.interp` on decreasing y overestimates the range | Event detection (Python) or step bisection (JS). The reference notebook shows the old method's error. |
| 5 | `K [N/s]` label; angle convention unverified | Labels say N/m. Convention checked against `drawing.svg`. The drawing also showed that the spring anchor is not the floor, so `pivot_height` was added (the notebook implicitly used $h = L_\text{foot}$). |
| 6 | Spring treated as zero rest length | $\tfrac12K[(l_i-l_0)^2-(l_f-l_0)^2]$, and a slack spring stores no energy. |

## Parameter degeneracy

Range data only constrain $\eta\,\Delta E/m_\text{eff}$, and $\Delta E \propto K$. So doubling $K$ while halving
$\eta$ gives an identical range (shown in the reference notebook). The tool therefore fixes the measured
quantities ($K$, $l_0$, $I$, $m$, lengths) and lets students fit:

1. **efficiency** $\eta$: the main knob;
2. **air resistance** $c$ (or $b$): model v2, a small effect at catapult speeds;
3. **release angle correction** $\delta$: changes the shape of the range-vs-stop-angle curve.

## Fit quality

The tool shows the RMS of *(model − mean of repeated shots)* over all measured settings. It compares this to the
average shot-to-shot standard deviation. When the model error is close to the spread, the model is as good as the
catapult's repeatability allows.
