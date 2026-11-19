"""Shared identity and updates for fermentation entities."""

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity import Entity

from .const import DOMAIN


class BatchEntity(Entity):
    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, entry, role):
        self.batch = entry.runtime_data
        self.role = role
        self._attr_translation_key = role
        self._attr_unique_id = f"{entry.unique_id}_{role}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.unique_id)}, name=entry.title
        )

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self.batch.listeners.add(self.async_write_ha_state)
        self.async_on_remove(lambda: self.batch.listeners.discard(self.async_write_ha_state))
