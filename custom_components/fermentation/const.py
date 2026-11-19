"""Fermentation device and sample fields."""

DOMAIN = "fermentation"
SAMPLES = {
    "hydrometer": ("°Bx", -5, 40, 0.1),
    "sample_temperature": ("°C", 0, 100, 0.1),
    "refractometer": ("°Bx", 0, 40, 0.1),
    "ph": (None, 0, 14, 0.01),
}
