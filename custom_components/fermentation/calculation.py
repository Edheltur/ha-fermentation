"""Density conversions and fermentation calculations in native instrument units."""

from math import isfinite
from statistics import median

DAY = 86400
WINDOW = 1800


def numeric(value):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if isfinite(result) else None


def brix(sg):
    return ((182.4601 * sg - 775.6821) * sg + 1262.7794) * sg - 669.5622


def specific_gravity(bx):
    """Invert the monotonic polynomial within the manual instrument range."""
    low, high = 0.8, 1.5
    if not brix(low) <= bx <= brix(high):
        return None
    for _ in range(52):
        mid = (low + high) / 2
        if brix(mid) < bx:
            low = mid
        else:
            high = mid
    return (low + high) / 2


def refractometer_abv(initial, final, wcf):
    """Estimate finished-beer ABV with Terrill's linear refractometer correction."""
    if initial is None or final is None or wcf is None or wcf <= 0:
        return None
    initial_brix = initial / wcf
    og = specific_gravity(initial_brix)
    if og is None or og <= 1 or final >= initial:
        return None
    final_brix = final / wcf
    fg = 1 - 0.00085683 * initial_brix + 0.0034941 * final_brix
    return 131.25 * (og - fg)


# GOST 6687.2-90, appendix 1, table 1. Rows: 15..25 °C.
# Columns: readings of 5, 10, 15, 20 and 25%. Units: hundredths of a scale point.
_SACCHAROMETER_CORRECTIONS = (
    (-21, -24, -26, -28, -30),
    (-18, -19, -21, -23, -24),
    (-13, -15, -16, -17, -18),
    (-9, -10, -11, -12, -12),
    (-5, -5, -6, -6, -6),
    (0, 0, 0, 0, 0),
    (5, 6, 6, 6, 6),
    (11, 11, 12, 12, 13),
    (16, 17, 18, 19, 20),
    (22, 23, 24, 26, 26),
    (28, 30, 31, 32, 33),
)


def hydrometer_at_20(reading, temperature):
    """Interpolate the scale correction within the published table."""
    if reading is None or temperature is None or temperature == 20:
        return reading
    if not (15 <= temperature <= 25 and 5 <= reading <= 25):
        return None
    row = min(int(temperature) - 15, 9)
    column = min(int(reading / 5) - 1, 3)
    t = temperature - (15 + row)
    x = reading / 5 - (1 + column)
    lower, upper = _SACCHAROMETER_CORRECTIONS[row : row + 2]
    low = lower[column] + x * (lower[column + 1] - lower[column])
    high = upper[column] + x * (upper[column + 1] - upper[column])
    return reading + (low + t * (high - low)) / 100


def manual_results(data):
    initial = hydrometer_at_20(
        data.get("initial_hydrometer"), data.get("initial_sample_temperature")
    )
    optical = data.get("initial_refractometer")
    final = hydrometer_at_20(data.get("final_hydrometer"), data.get("final_sample_temperature"))
    wcf = data.get("wcf")
    source = None
    og = None
    if initial is not None:
        og = specific_gravity(initial)
        source = "hydrometer"
    elif optical is not None and wcf:
        og = specific_gravity(optical / wcf)
        if og is not None:
            source = "refractometer"
    fg = specific_gravity(final) if final is not None else None
    difference = og - fg if og is not None and fg is not None else None
    return {
        "og": og,
        "fg": fg,
        "og_source": source,
        "applied_wcf": wcf if source == "refractometer" else None,
        "sample_wcf": optical / initial
        if optical is not None and initial and initial > 0
        else None,
        "final_abv": difference * 131.25 if difference is not None else None,
        "refractometer_abv": refractometer_abv(optical, data.get("final_refractometer"), wcf),
        "attenuation": difference * 100 / (og - 1) if difference is not None and og > 1 else None,
    }


def daily_delta(points, timestamp):
    def window(end):
        return [sg for t, sg in points if end - WINDOW < t <= end]

    recent, previous = window(timestamp), window(timestamp - DAY)
    if recent and previous:
        return brix(median(recent)) - brix(median(previous))
    return None
