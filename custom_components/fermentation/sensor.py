"""Live measurements and manual sample results."""

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.const import UnitOfTime

from .entity import BatchEntity

METRICS = {
    "duration": ("mdi:timer-sand", UnitOfTime.SECONDS, None),
    "sg": ("mdi:scale-balance", "SG", 4),
    "brix": ("mdi:cube-outline", "°Bx", 2),
    "temperature": ("mdi:thermometer-water", "°C", 1),
    "abv": ("mdi:liquor", "%", 2),
    "delta": ("mdi:chart-timeline-variant", "°Bx", 2),
    "og": ("mdi:flag-outline", "SG", 4),
    "fg": ("mdi:flag-checkered", "SG", 4),
    "sample_wcf": ("mdi:division", None, 4),
    "final_abv": ("mdi:liquor", "%", 2),
    "refractometer_abv": ("mdi:liquor", "%", 2),
    "attenuation": ("mdi:chart-waterfall", "%", 1),
}


async def async_setup_entry(hass, entry, async_add_entities):
    async_add_entities(BatchSensor(entry, key) for key in METRICS)


class BatchSensor(BatchEntity, SensorEntity):
    def __init__(self, entry, role):
        super().__init__(entry, role)
        (
            self._attr_icon,
            self._attr_native_unit_of_measurement,
            self._attr_suggested_display_precision,
        ) = METRICS[role]
        if role in ("sg", "brix", "temperature", "abv", "delta"):
            self._attr_state_class = SensorStateClass.MEASUREMENT
        if role == "temperature":
            self._attr_device_class = SensorDeviceClass.TEMPERATURE
        elif role == "duration":
            self._attr_device_class = SensorDeviceClass.DURATION
            self._attr_suggested_unit_of_measurement = UnitOfTime.DAYS

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
        if self.role == "fg":
            return {"fg_source": self.batch.values["fg_source"]}
        return None
