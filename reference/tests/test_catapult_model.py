"""Tests for the Python reference model."""

import math

import pytest

from catapult_model import (
    CatapultParams,
    effective_mass,
    launch_speed,
    launch_state,
    max_pull_back,
    range_no_drag,
    released_energy,
    rod_inertia,
    simulate,
    spring_length,
    throw_range,
)

DEFAULT = CatapultParams()

# The parameter values of the original Model.ipynb.
NOTEBOOK = CatapultParams(theta_i=3 * math.pi / 4, theta_f=math.pi / 6, inertia=1e-3, pivot_height=0.03)


def test_notebook_energy_bug_fixed():
    # Review: with I/L_left**2 the launch speed is 1.07 m/s (the buggy I/L_left*2 gave 3.07).
    assert effective_mass(NOTEBOOK) == pytest.approx(0.41)
    assert launch_speed(NOTEBOOK) == pytest.approx(1.0729, abs=1e-4)


def test_zero_rest_length_matches_notebook_formula():
    p = NOTEBOOK
    du_notebook = p.k * p.l_foot * p.l_right * (math.cos(p.theta_i) - math.cos(p.theta_f))
    assert released_energy(p) == pytest.approx(-du_notebook)


def test_rest_length_reduces_energy():
    with_l0 = DEFAULT.with_(l0=0.02)
    li, lf = spring_length(DEFAULT, DEFAULT.theta_i), spring_length(DEFAULT, DEFAULT.theta_f)
    expected = 0.5 * DEFAULT.k * ((li - 0.02) ** 2 - (lf - 0.02) ** 2)
    assert released_energy(with_l0) == pytest.approx(expected)
    assert released_energy(with_l0) < released_energy(DEFAULT)


def test_slack_spring_stores_no_energy():
    p = DEFAULT.with_(l0=1.0)
    assert released_energy(p) == 0.0
    assert launch_speed(p) == 0.0


def test_release_velocity_is_perpendicular_to_arm():
    x, y, vx, vy = launch_state(DEFAULT)
    arm = (x - 0.0, y - DEFAULT.pivot_height)  # pivot -> cup
    assert arm[0] * vx + arm[1] * vy == pytest.approx(0.0, abs=1e-12)


def test_efficiency_scales_kinetic_energy():
    half = DEFAULT.with_(efficiency=0.5)
    assert launch_speed(half) == pytest.approx(launch_speed(DEFAULT) * math.sqrt(0.5))


@pytest.mark.parametrize("theta_f_deg", [5, 20, 30, 45, 60, 80])
def test_integrator_matches_closed_form_without_drag(theta_f_deg):
    p = DEFAULT.with_(theta_f=math.radians(theta_f_deg))
    assert throw_range(p) == pytest.approx(range_no_drag(p), abs=1e-8)


@pytest.mark.parametrize("model,coeff", [("linear", 2e-3), ("quadratic", 5e-4)])
def test_drag_shortens_range(model, coeff):
    p = DEFAULT.with_(drag_model=model, drag=coeff)
    assert throw_range(p) < throw_range(DEFAULT)


def test_linear_drag_matches_analytic_solution():
    # With linear drag x(t) and y(t) have closed forms; check the landing x.
    p = DEFAULT.with_(drag_model="linear", drag=2e-3)
    x0, y0, vx, vy = launch_state(p)
    gam = p.drag / p.mass
    t_land, x_land, _ = simulate(p)
    y_t = y0 + (vy + p.g / gam) / gam * (1 - math.exp(-gam * t_land)) - p.g / gam * t_land
    x_t = x0 + vx / gam * (1 - math.exp(-gam * t_land))
    assert y_t == pytest.approx(0.0, abs=1e-9)
    assert x_land == pytest.approx(x_t, abs=1e-9)


def test_trajectory_ends_on_ground():
    _, x_land, traj = simulate(DEFAULT.with_(drag_model="quadratic", drag=1e-4))
    assert traj[-1, 1] == pytest.approx(0.0, abs=1e-9)
    assert traj[-1, 0] == pytest.approx(x_land)


def test_ball_below_ground_is_rejected():
    with pytest.raises(ValueError):
        simulate(DEFAULT.with_(theta_f=math.radians(170), pivot_height=0.03))


def test_max_pull_back_puts_cup_on_ground():
    low = DEFAULT.with_(pivot_height=0.03)
    th = max_pull_back(low)
    assert low.pivot_height + low.l_left * math.cos(th) == pytest.approx(0.0, abs=1e-12)
    assert max_pull_back(DEFAULT) == math.pi  # pivot higher than the arm is long


def test_rod_inertia_centre_pivot():
    # Uniform rod pivoting in the middle: M L^2 / 12.
    assert rod_inertia(0.012, 0.05, 0.05) == pytest.approx(0.012 * 0.1**2 / 12)
