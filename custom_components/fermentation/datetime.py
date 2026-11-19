"""Editable fermentation dates."""

from datetime import UTC, datetime

from homeassistant.components.datetime import DateTimeEntity

from .entity import BatchEntity


async def async_setup_entry(hass, entry, async_add_entities):
    async_add_entities(BatchDate(entry, role) for role in ("start", "end"))


class BatchDate(BatchEntity, DateTimeEntity):
    def __init__(self, entry, role):
        super().__init__(entry, role)
        self._attr_icon = "mdi:calendar-start" if role == "start" else "mdi:calendar-end"

    @property
    def native_value(self):
        timestamp = self.batch.data.get(self.role)
        return datetime.fromtimestamp(timestamp, UTC) if timestamp is not None else None

    async def async_set_value(self, value):
        self.batch.set_field(self.role, value.timestamp())
