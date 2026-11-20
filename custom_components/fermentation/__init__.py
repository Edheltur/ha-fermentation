"""Track a fermentation as one Home Assistant device."""

from homeassistant.const import Platform
from homeassistant.helpers.service import async_register_platform_entity_service

from .batch import Batch, sample_store
from .const import DOMAIN
from .dashboard import async_setup_dashboard

PLATFORMS = (Platform.BINARY_SENSOR, Platform.DATETIME, Platform.NUMBER, Platform.SENSOR)


async def async_setup(hass, config):
    await async_setup_dashboard(hass)
    async_register_platform_entity_service(
        hass,
        DOMAIN,
        "clear_sample",
        entity_domain=Platform.NUMBER,
        schema={},
        func="async_clear_sample",
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
