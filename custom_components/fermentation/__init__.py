"""Track a fermentation as one Home Assistant device."""

from homeassistant.const import Platform
from homeassistant.helpers.service import async_register_platform_entity_service

from .batch import Batch, sample_store
from .const import DOMAIN

PLATFORMS = (Platform.BINARY_SENSOR, Platform.DATETIME, Platform.NUMBER, Platform.SENSOR)


async def async_setup(hass, config):
    for platform, service in (
        (Platform.DATETIME, "clear_date"),
        (Platform.NUMBER, "clear_reading"),
    ):
        async_register_platform_entity_service(
            hass, DOMAIN, service, entity_domain=platform, func="async_clear", schema={}
        )
    return True


async def async_setup_entry(hass, entry):
    batch = entry.runtime_data = Batch(hass, entry)
    await batch.load()
    entry.async_on_unload(batch.stop)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass, entry):
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    batch = entry.runtime_data
    batch.stop()
    await batch.store.async_save(batch.points)
    return True


async def async_remove_entry(hass, entry):
    await sample_store(hass, entry).async_remove()
