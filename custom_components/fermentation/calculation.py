"""Density conversions and fermentation calculations in native instrument units."""

from math import asinh, isfinite, sinh, sqrt
from statistics import median

DAY = 86400
WINDOW = 1800
SG_MIN, SG_MAX = 0.8, 1.5
_BRIX_A, _BRIX_B, _BRIX_C, _BRIX_D = 182.4601, -775.6821, 1262.7794, -669.5622


def numeric(value):
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return result if isfinite(result) else None


def sg_reading(value):
    sg = numeric(value)
    return sg if sg is not None and SG_MIN <= sg <= SG_MAX else None


def brix(sg):
    return ((_BRIX_A * sg + _BRIX_B) * sg + _BRIX_C) * sg + _BRIX_D


_BRIX_MIN, _BRIX_MAX = brix(SG_MIN), brix(SG_MAX)
_BRIX_CENTER = -_BRIX_B / (3 * _BRIX_A)
_BRIX_AT_CENTER = brix(_BRIX_CENTER)
_BRIX_HEIGHT = sqrt((_BRIX_C - _BRIX_B**2 / (3 * _BRIX_A)) / (3 * _BRIX_A))
_BRIX_SCALE = 2 * _BRIX_A * _BRIX_HEIGHT**3


def specific_gravity(bx):
    """Solve the depressed cubic with its single real root."""
    if not _BRIX_MIN <= bx <= _BRIX_MAX:
        return None
    if bx == _BRIX_MIN:
        return SG_MIN
    if bx == _BRIX_MAX:
        return SG_MAX
    sg = _BRIX_CENTER + 2 * _BRIX_HEIGHT * sinh(asinh((bx - _BRIX_AT_CENTER) / _BRIX_SCALE) / 3)
    return min(SG_MAX, max(SG_MIN, sg))


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


# Source: ГОСТ 6687.2-90, appendix 1, table 1 (saccharometer temperature corrections).
# https://base.garant.ru/70240954/53f89421bbdaf741eb2d1ecc4ddb4c33/
# Rows: 15..25 °C. The 20 °C reference row has zero correction by definition.
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
    initial_brix = None
    if initial is not None:
        initial_brix = initial
        source = "hydrometer"
    elif optical is not None and wcf:
        initial_brix = optical / wcf
        source = "refractometer"
    og = specific_gravity(initial_brix) if initial_brix is not None else None
    if og is None:
        source = None
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
        "attenuation": difference * 100 / (og - 1)
        if difference is not None and initial_brix > 0 and og > 1
        else None,
    }


def daily_delta(points, timestamp):
    def window(end):
        return [sg for t, sg in points if end - WINDOW < t <= end]

    recent, previous = window(timestamp), window(timestamp - DAY)
    if recent and previous:
        return brix(median(recent)) - brix(median(previous))
    return None
