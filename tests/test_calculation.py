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


@pytest.mark.parametrize(
    ("reading", "temperature", "expected"),
    [
        (5, 15, 4.79),
        (25, 25, 25.33),
        (12.2, 22, 12.3144),
        (12.5, 21.5, 12.5875),
        (3.2, 20, 3.2),
        (3.2, 19.9, None),
        (3.2, 20.1, None),
        (3.2, 5, None),
        (3.2, 22, None),
    ],
)
def test_temperature_correction(reading, temperature, expected):
    data = {
        "initial_hydrometer": reading,
        "initial_sample_temperature": temperature,
        "final_hydrometer": reading,
        "final_sample_temperature": temperature,
        "initial_refractometer": 14,
        "wcf": 1,
    }
    result = manual_results(data)
    if expected is None:
        assert result["fg"] is None
        assert result["sample_wcf"] is None
        assert result["og_source"] == "refractometer"
    else:
        assert result["fg"] == pytest.approx(specific_gravity(expected))
        assert result["og"] == result["fg"]
        assert result["sample_wcf"] == pytest.approx(14 / expected)


@pytest.mark.parametrize("field", ["initial_hydrometer", "initial_refractometer"])
def test_zero_initial_extract_has_no_attenuation(field):
    result = manual_results({field: 0, "wcf": 1.04, "final_hydrometer": -0.1})
    assert result["og"] is not None
    assert result["attenuation"] is None
