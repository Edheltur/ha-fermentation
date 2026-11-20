"""Exercise automatic Lovelace resource registration."""

import pytest
from homeassistant.components.lovelace import LovelaceData
from homeassistant.components.lovelace.const import LOVELACE_DATA
from homeassistant.components.lovelace.dashboard import LovelaceStorage
from homeassistant.components.lovelace.resources import (
    ResourceStorageCollection,
    ResourceYAMLCollection,
)
from homeassistant.setup import async_setup_component

from custom_components.fermentation.const import DOMAIN

CARD_URL = "/api/fermentation/static/fermentation-card.js"


@pytest.mark.parametrize("mode", ["storage", "existing", "yaml"])
async def test_dashboard_card_resource(hass, mode):
    existing = {"id": "existing", "type": "module", "url": "/local/existing.js"}
    if mode == "yaml":
        resources = ResourceYAMLCollection([existing])
    else:
        resources = ResourceStorageCollection(hass, LovelaceStorage(hass, None))
        items = [existing]
        if mode == "existing":
            items.append({"id": "manual", "type": "module", "url": f"{CARD_URL}?v=1"})
        await resources.store.async_save({"items": items})
        assert not resources.loaded

    hass.data[LOVELACE_DATA] = LovelaceData(
        resource_mode="yaml" if mode == "yaml" else "storage",
        dashboards={},
        resources=resources,
        yaml_dashboards={},
    )
    assert await async_setup_component(hass, DOMAIN, {})

    expected = [existing["url"]]
    if mode == "storage":
        expected.append(CARD_URL)
    elif mode == "existing":
        expected.append(f"{CARD_URL}?v=1")
    assert [(item["url"], item["type"]) for item in resources.async_items()] == [
        (url, "module") for url in expected
    ]
