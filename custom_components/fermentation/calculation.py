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


def manual_results(data):
    initial = data.get("initial_hydrometer")
    optical = data.get("initial_refractometer")
    final = data.get("final_hydrometer")
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
        "attenuation": difference * 100 / (og - 1) if difference is not None and og > 1 else None,
    }


def daily_delta(points, timestamp):
    def window(end):
        return [sg for t, sg in points if end - WINDOW < t <= end]

    recent, previous = window(timestamp), window(timestamp - DAY)
    if recent and previous:
        return brix(median(recent)) - brix(median(previous))
    return None
