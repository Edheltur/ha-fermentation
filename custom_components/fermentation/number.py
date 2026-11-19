"""Manual readings for the initial and final samples."""

from homeassistant.components.number import NumberEntity, NumberMode

from .const import SAMPLES
from .entity import EditableField


async def async_setup_entry(hass, entry, async_add_entities):
    async_add_entities(
        SampleField(entry, f"{stage}_{key}", limits)
        for stage in ("initial", "final")
        for key, limits in SAMPLES.items()
    )


class SampleField(EditableField, NumberEntity):
    _attr_mode = NumberMode.BOX

    def __init__(self, entry, role, limits):
        super().__init__(entry, role)
        (
            self._attr_native_unit_of_measurement,
            self._attr_native_min_value,
            self._attr_native_max_value,
            self._attr_native_step,
        ) = limits

    @property
    def native_value(self):
        return self.batch.data.get(self.role)

    async def async_set_native_value(self, value):
        self.batch.set_field(self.role, value)
