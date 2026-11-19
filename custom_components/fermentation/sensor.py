"""Live measurements and manual sample results."""

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass

from .entity import BatchEntity

METRICS = {
    "duration": ("s", 0),
    "sg": ("SG", 4),
    "brix": ("°Bx", 2),
    "temperature": ("°C", 1),
    "abv": ("%", 2),
    "delta": ("°Bx", 2),
    "og": ("SG", 4),
    "fg": ("SG", 4),
    "sample_wcf": (None, 4),
    "final_abv": ("%", 2),
    "attenuation": ("%", 1),
}


async def async_setup_entry(hass, entry, async_add_entities):
    async_add_entities(BatchSensor(entry, key) for key in METRICS)


class BatchSensor(BatchEntity, SensorEntity):
    def __init__(self, entry, role):
        super().__init__(entry, role)
        self._attr_native_unit_of_measurement, self._attr_suggested_display_precision = METRICS[
            role
        ]
        if role in ("sg", "brix", "temperature", "abv", "delta"):
            self._attr_state_class = SensorStateClass.MEASUREMENT
        if role == "temperature":
            self._attr_device_class = SensorDeviceClass.TEMPERATURE
        elif role == "duration":
            self._attr_device_class = SensorDeviceClass.DURATION

    @property
    def native_value(self):
        return self.batch.values[self.role]

    @property
    def available(self):
        return self.native_value is not None

    @property
    def extra_state_attributes(self):
        if self.role == "og":
            return {key: self.batch.values[key] for key in ("og_source", "applied_wcf")}
        return None
