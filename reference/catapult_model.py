"""Reference implementation of the catapult model (corrected).

This module is the "source of truth" that the browser tool (web/js/model.js)
is validated against. It deliberately favours clarity and accuracy over speed:
the flight is integrated with scipy's ``solve_ivp`` at tight tolerances and the
landing point is found with event detection instead of interpolation.

Geometry and conventions (origin on the floor directly below the pivot, x forward,
y up). All angles are the angle of the *throwing arm* (pivot -> ball cup)
measured from the vertical, which is also the angle between the spring arm and
the foot:

* The pivot is at height ``pivot_height`` above the landing surface. The
  spring is anchored on the foot, ``l_foot`` below the pivot. (The notebook
  put the floor at the spring anchor, i.e. ``pivot_height == l_foot``; the
  schematic drawing shows they are different points.)
* The ball cup is at ``l_left`` from the pivot, direction (-sin th, cos th).
* The spring connects that anchor to the other end of the rod at
  ``l_right`` from the pivot. By the law of cosines its length is
  ``l(th)^2 = l_foot^2 + l_right^2 - 2 l_foot l_right cos(th)``.
* The arm swings from the pull-back angle ``theta_i`` down to the stop angle
  ``theta_f``. At release the ball moves perpendicular to the arm, i.e. along
  (cos th_f, sin th_f): the launch elevation above horizontal equals theta_f.
  An optional ``release_offset`` shifts the release angle (not the energy) to
  lump effects such as arm flex or the ball leaving the cup early.

Fixes relative to the original notebook (see docs/MODEL.md):

1. effective mass is ``I / l_left**2 + m`` (the notebook had ``I/l_left*2``);
2. a realistic default moment of inertia, plus a helper to estimate it;
3. drag coefficients are in force units and divided by the ball mass;
   linear (b, N s/m) and quadratic (c, kg/m) drag are both supported;
4. the landing point is found with event detection at y = 0;
5. angle convention checked against drawing.svg; the floor is separated
   from the spring anchor via ``pivot_height``;
6. the spring has a rest length ``l0`` and cannot push when slack.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace

import numpy as np
from scipy.integrate import solve_ivp

G = 9.81  # m/s^2

DRAG_MODELS = ("none", "linear", "quadratic")


@dataclass(frozen=True)
class CatapultParams:
    """All parameters of the model, in SI units (angles in radians)."""

    l_left: float = 0.05  # m, pivot -> ball cup
    l_right: float = 0.05  # m, pivot -> spring attachment
    l_foot: float = 0.03  # m, pivot -> spring anchor on the foot
    pivot_height: float = 0.08  # m, pivot above the landing surface
    theta_i: float = math.radians(120)  # pull-back angle
    theta_f: float = math.radians(30)  # stop angle = launch elevation
    k: float = 100.0  # N/m, spring constant
    l0: float = 0.0  # m, spring rest length
    inertia: float = 1.5e-5  # kg m^2, rod (+ cup) about the pivot
    mass: float = 0.01  # kg, ball
    efficiency: float = 1.0  # fraction of spring energy that ends up as kinetic energy
    drag_model: str = "none"
    drag: float = 0.0  # b [N s/m] for linear, c [kg/m] for quadratic
    release_offset: float = 0.0  # rad, ball leaves at theta_f + offset (arm flex, early release)
    g: float = G

    def with_(self, **changes) -> "CatapultParams":
        return replace(self, **changes)


def rod_inertia(rod_mass: float, l_left: float, l_right: float, cup_mass: float = 0.0) -> float:
    """Moment of inertia of a uniform rod pivoting at an interior point, plus a point-mass cup.

    For a uniform rod of total length L = l_left + l_right pivoting at distance
    l_left from one end: I = M (l_left^3 + l_right^3) / (3 L).
    """
    length = l_left + l_right
    return rod_mass * (l_left**3 + l_right**3) / (3 * length) + cup_mass * l_left**2


def spring_length(p: CatapultParams, theta: float) -> float:
    return math.sqrt(p.l_foot**2 + p.l_right**2 - 2 * p.l_foot * p.l_right * math.cos(theta))


def spring_energy(p: CatapultParams, theta: float) -> float:
    """Elastic energy stored at arm angle theta. A slack spring/band stores nothing."""
    stretch = max(spring_length(p, theta) - p.l0, 0.0)
    return 0.5 * p.k * stretch**2


def released_energy(p: CatapultParams) -> float:
    """Spring energy released while the arm swings from theta_i to theta_f (>= 0)."""
    return max(spring_energy(p, p.theta_i) - spring_energy(p, p.theta_f), 0.0)


def effective_mass(p: CatapultParams) -> float:
    """Mass that 'feels' the kinetic energy: KE = 1/2 m_eff v^2 with v = omega l_left."""
    return p.inertia / p.l_left**2 + p.mass


def launch_speed(p: CatapultParams) -> float:
    return math.sqrt(2 * p.efficiency * released_energy(p) / effective_mass(p))


def launch_state(p: CatapultParams) -> np.ndarray:
    """Initial state (x, y, vx, vy) of the ball at release."""
    v0 = launch_speed(p)
    th = p.theta_f + p.release_offset
    return np.array(
        [
            -p.l_left * math.sin(th),
            p.pivot_height + p.l_left * math.cos(th),
            v0 * math.cos(th),
            v0 * math.sin(th),
        ]
    )


def max_pull_back(p: CatapultParams) -> float:
    """Largest arm angle before the ball cup touches the ground (or pi)."""
    if p.pivot_height >= p.l_left:
        return math.pi
    return math.acos(-p.pivot_height / p.l_left)


def _rhs(p: CatapultParams):
    if p.drag_model not in DRAG_MODELS:
        raise ValueError(f"unknown drag model {p.drag_model!r}")

    def rhs(_t, s):
        _x, _y, vx, vy = s
        if p.drag_model == "linear":
            a = p.drag / p.mass
            ax, ay = -a * vx, -a * vy
        elif p.drag_model == "quadratic":
            a = p.drag / p.mass * math.hypot(vx, vy)
            ax, ay = -a * vx, -a * vy
        else:
            ax = ay = 0.0
        return [vx, vy, ax, ay - p.g]

    return rhs


def simulate(p: CatapultParams, n_samples: int = 200):
    """Integrate the flight until y = 0.

    Returns (t_land, x_land, trajectory) where trajectory is an (n, 2) array of
    (x, y) points from release to landing.
    """
    s0 = launch_state(p)
    if s0[1] <= 0:
        raise ValueError("ball starts at or below the ground; check geometry/angles")

    def hit_ground(_t, s):
        return s[1]

    hit_ground.terminal = True
    hit_ground.direction = -1

    # Generous upper bound on flight time: drag only shortens it.
    vy0 = max(s0[3], 0.0)
    t_max = 2 * (vy0 / p.g + math.sqrt(2 * s0[1] / p.g + (vy0 / p.g) ** 2)) + 1.0

    sol = solve_ivp(
        _rhs(p), (0.0, t_max), s0, events=hit_ground, dense_output=True, rtol=1e-11, atol=1e-13
    )
    if sol.t_events[0].size == 0:
        raise RuntimeError("ball did not land within t_max")
    t_land = float(sol.t_events[0][0])
    x_land = float(sol.y_events[0][0][0])
    ts = np.linspace(0.0, t_land, n_samples)
    traj = sol.sol(ts)[:2].T
    return t_land, x_land, traj


def throw_range(p: CatapultParams) -> float:
    """Horizontal landing position (m from the foot)."""
    return simulate(p)[1]


def range_no_drag(p: CatapultParams) -> float:
    """Closed-form range without drag; used to check the integrator."""
    x0, y0, vx, vy = launch_state(p)
    t = (vy + math.sqrt(vy**2 + 2 * p.g * y0)) / p.g
    return x0 + vx * t
