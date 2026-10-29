"""Scoring rule for prediction shots.

Must stay identical to ``scoreShot`` in web/js/analysis.js; both are tested
against the same cases (reference/generate_fixtures.py exports them).
"""

import math

BAND_CM = 5
MAX_POINTS = 10


def score_shot(miss_m: float, band_cm: float = BAND_CM, max_points: int = MAX_POINTS) -> int:
    """Full points within one band of the target, minus one point per extra band, never below 0."""
    bands = math.floor(abs(miss_m) * 100 / band_cm + 1e-9)
    return max(max_points - bands, 0)
