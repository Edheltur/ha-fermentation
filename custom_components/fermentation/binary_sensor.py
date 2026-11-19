"""Interval-based active flag."""

from homeassistant.components.binary_sensor import BinarySensorEntity

from .entity import BatchEntity


async def async_setup_entry(hass, entry, async_add_entities):
    async_add_entities([Active(entry, "active")])


class Active(BatchEntity, BinarySensorEntity):
    @property
    def is_on(self):
        return self.batch.values["active"]
