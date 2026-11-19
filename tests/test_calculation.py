"""Acceptance examples for manual readings and the minute window."""

import pytest

from custom_components.fermentation.calculation import (
    DAY,
    WINDOW,
    brix,
    daily_delta,
    manual_results,
    specific_gravity,
)


def test_manual_provenance():
    sample = {"initial_refractometer": 12}
    assert manual_results(sample)["og"] is None
    sample["wcf"] = 1.05
    assert manual_results(sample)["og"] == pytest.approx(specific_gravity(12 / 1.05))
    sample["initial_hydrometer"] = 11.5
    result = manual_results(sample)
    assert result["og_source"] == "hydrometer"
    assert result["applied_wcf"] is None
    assert result["sample_wcf"] == pytest.approx(1.043478, abs=1e-6)
    assert result["final_abv"] is None


def test_final_results():
    result = manual_results({"initial_hydrometer": brix(1.050), "final_hydrometer": brix(1.010)})
    assert result["final_abv"] == pytest.approx(5.25)
    assert result["attenuation"] == pytest.approx(80)


def test_day_boundary_and_medians():
    a, b = specific_gravity(8), specific_gravity(7.8)
    points = [(0, a), (DAY - WINDOW, 1.09), (DAY, b)]
    assert daily_delta(points, DAY - 60) is None
    assert daily_delta(points, DAY) == pytest.approx(-0.2)
    assert daily_delta(points, DAY + WINDOW) is None
    assert daily_delta([(0, a), (60, a), (120, 1.3), (DAY + 120, b)], DAY + 120) == pytest.approx(
        -0.2
    )
