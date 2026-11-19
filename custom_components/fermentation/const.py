"""Fermentation device and sample fields."""

DOMAIN = "fermentation"
SAMPLES = {
    "hydrometer": ("mdi:gauge", "°Bx", -5, 40, 0.1),
    "sample_temperature": ("mdi:thermometer", "°C", 0, 100, 0.1),
    "refractometer": ("mdi:angle-acute", "°Bx", 0, 40, 0.1),
    "ph": ("mdi:test-tube", None, 0, 14, 0.01),
}
