"""Acceptance examples for manual readings and the minute window."""

from math import inf, nextafter

import pytest

from custom_components.fermentation.calculation import (
    DAY,
    SG_MAX,
    SG_MIN,
    WINDOW,
    brix,
    daily_delta,
    gravity_results,
    specific_gravity,
)


def test_manual_provenance():
    sample = {"initial_refractometer": 12}
    assert gravity_results(sample)["og"] is None
    sample["wcf"] = 1.05
    assert gravity_results(sample)["og"] == pytest.approx(specific_gravity(12 / 1.05))
    sample["initial_hydrometer"] = 11.5
    result = gravity_results(sample)
    assert result["og_source"] == "hydrometer"
    assert result["applied_wcf"] is None
    assert result["sample_wcf"] == pytest.approx(1.043478, abs=1e-6)
    assert result["final_abv"] is None


def test_final_results():
    result = gravity_results({"initial_hydrometer": brix(1.050), "final_hydrometer": brix(1.010)})
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
    result = gravity_results(data)
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
    result = gravity_results({field: 0, "wcf": 1.04, "final_hydrometer": -0.1})
    assert result["og"] is not None
    assert result["attenuation"] is None


def test_analytical_inverse_across_sg_range():
    minimum, maximum = brix(SG_MIN), brix(SG_MAX)
    assert specific_gravity(minimum) == SG_MIN
    assert specific_gravity(maximum) == SG_MAX
    assert specific_gravity(nextafter(minimum, -inf)) is None
    assert specific_gravity(nextafter(maximum, inf)) is None
    for invalid in (float("nan"), -inf, inf):
        assert specific_gravity(invalid) is None
    assert f"{specific_gravity(3):.4f}" == "1.0117"
    assert f"{specific_gravity(12):.4f}" == "1.0484"
    assert (
        max(
            abs(specific_gravity(brix(sg)) - sg)
            for sg in (index / 100_000 for index in range(80_000, 150_001))
        )
        < 1e-14
    )


def test_working_wcf_changes_optical_abv_only_when_hydrometer_controls_og():
    readings = {
        "initial_hydrometer": 12,
        "final_hydrometer": 3,
        "initial_refractometer": 12.5,
        "final_refractometer": 6,
    }
    a = gravity_results({**readings, "wcf": 1.04})
    b = gravity_results({**readings, "wcf": 1.05})
    without_wcf = gravity_results(readings)
    assert a["og"] == b["og"] == without_wcf["og"]
    assert a["final_abv"] == b["final_abv"] == without_wcf["final_abv"]
    assert a["refractometer_abv"] != b["refractometer_abv"]
    assert without_wcf["refractometer_abv"] is None


def test_pill_only_and_manual_priority():
    data = {}
    results = gravity_results(data, 1.05, 1.01)
    assert results["og_source"] == results["fg_source"] == "pill"
    assert results["final_abv"] == pytest.approx(5.25)
    assert results["attenuation"] == pytest.approx(80)
    data.update(initial_refractometer=12, final_refractometer=5, wcf=1.04)
    results = gravity_results(data, 1.05, 1.01)
    assert results["og_source"] == results["fg_source"] == "refractometer"
    assert results["fg"] == pytest.approx(1 - 0.00085683 * 12 / 1.04 + 0.0034941 * 5 / 1.04)
    data.update(initial_hydrometer=12, final_hydrometer=3)
    results = gravity_results(data, 1.05, 1.01)
    assert results["og_source"] == results["fg_source"] == "hydrometer"
