"""Exercise the config flow, entity services and reload on HA Core."""

from datetime import timedelta
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.config_entries import SOURCE_USER, ConfigEntry
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

from custom_components.fermentation.const import DOMAIN


async def create(hass, device):
    form = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(
        form["flow_id"], {"pill": device, "name": "Test batch", "wcf": 1.04}
    )
    await hass.async_block_till_done()
    return result


async def pill(hass):
    # Register the same public entity metadata as RAPT Bluetooth.

    pill_entry = ConfigEntry(
        version=1,
        minor_version=1,
        domain="rapt_ble",
        title="Pill",
        data={},
        options={},
        source=SOURCE_USER,
        unique_id="pill",
        discovery_keys={},
        subentries_data=[],
    )
    with patch.object(hass.config_entries, "async_setup", new=AsyncMock(return_value=True)):
        await hass.config_entries.async_add(pill_entry)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=pill_entry.entry_id, identifiers={("rapt_ble", "pill")}
    )
    return device


async def test_batch_lifecycle(hass):
    registry = er.async_get(hass)
    device = await pill(hass)
    missing = await create(hass, device.id)
    assert missing["errors"] == {"pill": "missing_sg"}
    source = registry.async_get_or_create(
        "sensor",
        "rapt_ble",
        "address-specific_gravity",
        device_id=device.id,
        suggested_object_id="renamed_pill",
    )
    hass.states.async_set(source.entity_id, "1.010")
    a, b = [(await create(hass, device.id))["result"] for _ in range(2)]
    assert a.unique_id != b.unique_id

    def entity(entry, domain, role):
        result = registry.async_get_entity_id(domain, DOMAIN, f"{entry.unique_id}_{role}")
        assert result
        return result

    def state(entry, domain, role):
        return hass.states.get(entity(entry, domain, role)).state

    async def set_value(entry, domain, role, value):
        field = "datetime" if domain == "datetime" else "value"
        await hass.services.async_call(
            domain,
            "set_value",
            {"entity_id": entity(entry, domain, role), field: value},
            blocking=True,
        )

    now = dt_util.utcnow()
    assert state(a, "sensor", "sg") == "unavailable"
    await set_value(a, "datetime", "start", now - timedelta(hours=26))
    active_id = entity(a, "binary_sensor", "active")
    assert hass.states.get(active_id).attributes["icon"] == "mdi:flask"
    assert hass.states.get(entity(a, "sensor", "sg")).attributes["icon"] == "mdi:scale-balance"
    assert float(state(a, "sensor", "sg")) == 1.010
    duration = hass.states.get(entity(a, "sensor", "duration"))
    assert duration.attributes["unit_of_measurement"] == "d"
    assert float(duration.state) == pytest.approx(26 / 24, abs=1 / 86400)
    with pytest.raises(ServiceValidationError):
        await set_value(b, "datetime", "start", now)
    assert state(b, "datetime", "start") == "unknown"
    await set_value(a, "number", "initial_hydrometer", 12)
    assert float(state(a, "sensor", "abv")) > 4
    batch = a.runtime_data
    batch.sample(now)
    assert len(batch.points) == 1
    hass.states.async_set(source.entity_id, "unavailable")
    await hass.async_block_till_done()
    assert state(a, "sensor", "abv") == "unavailable"
    await set_value(a, "datetime", "end", now)
    assert state(a, "binary_sensor", "active") == "off"
    assert hass.states.get(active_id).attributes["icon"] == "mdi:flask-outline"
    await set_value(a, "number", "final_hydrometer", 3)
    assert float(state(a, "sensor", "final_abv")) > 4
    assert state(a, "sensor", "refractometer_abv") == "unavailable"
    await set_value(a, "number", "initial_refractometer", 12.5)
    await set_value(a, "number", "final_refractometer", 4)
    assert float(state(a, "sensor", "refractometer_abv")) == pytest.approx(5.94719, abs=0.00001)
    await hass.config_entries.async_reload(a.entry_id)
    assert state(a, "binary_sensor", "active") == "off"
    assert float(state(a, "number", "final_hydrometer")) == 3


async def test_sampling_and_source_recovery(hass):
    device = await pill(hass)
    registry = er.async_get(hass)
    sg = registry.async_get_or_create(
        "sensor", "rapt_ble", "pill-specific_gravity", device_id=device.id
    )
    temp = registry.async_get_or_create(
        "sensor",
        "rapt_ble",
        "pill-temperature",
        device_id=device.id,
        original_device_class="temperature",
    )
    hass.states.async_set(sg.entity_id, "1.04")
    hass.states.async_set(temp.entity_id, "68", {"unit_of_measurement": "°F"})
    entry = (await create(hass, device.id))["result"]
    batch = entry.runtime_data
    now = dt_util.utcnow().replace(second=0, microsecond=0)
    start = now - timedelta(days=1)
    batch.set_field("start", start.timestamp())
    for minute in range(20):
        batch.sample(start + timedelta(minutes=minute))
    assert len(batch.points) == 20
    hass.states.async_set(sg.entity_id, "1.01")
    await hass.async_block_till_done()
    assert len(batch.points) == 20
    batch.sample(now)
    assert batch.values["delta"] < 0
    expected = list(batch.points)
    batch.points.append((now.timestamp(), 1e308))
    await hass.config_entries.async_reload(entry.entry_id)
    batch = entry.runtime_data
    assert batch.points == expected
    assert batch.values["delta"] < 0
    for invalid in ("nan", "1e308"):
        hass.states.async_set(sg.entity_id, invalid)
        await hass.async_block_till_done()
        assert batch.values["sg"] is None
        assert batch.values["delta"] is None
    assert batch.values["temperature"] == pytest.approx(20)
    batch.sample(now)
    assert batch.points == expected
    hass.states.async_set(sg.entity_id, "1.02")
    await hass.async_block_till_done()
    assert batch.values["sg"] == 1.02


async def test_shared_boundary_and_overlap_conflict(hass):
    device = await pill(hass)
    sg = er.async_get(hass).async_get_or_create(
        "sensor", "rapt_ble", "pill-specific_gravity", device_id=device.id
    )
    hass.states.async_set(sg.entity_id, "1.01")
    earlier, later = [(await create(hass, device.id))["result"].runtime_data for _ in range(2)]
    boundary = dt_util.utcnow().replace(second=0, microsecond=0) + timedelta(hours=1)
    earlier.set_field("start", (boundary - timedelta(days=1)).timestamp())
    earlier.set_field("end", boundary.timestamp())
    later.set_field("start", boundary.timestamp())
    with pytest.raises(ServiceValidationError):
        earlier.set_field("end", (boundary + timedelta(minutes=1)).timestamp())
    with patch("custom_components.fermentation.batch.dt_util.utcnow", return_value=boundary):
        earlier.reschedule(boundary)
        later.reschedule(boundary)
        earlier.sample(boundary)
        assert not earlier.points
        assert later.points == [(boundary.timestamp(), 1.01)]
        assert not earlier.values["active"]
        assert later.values["active"]


async def test_reconfigure_archived_optical_batch(hass):
    device = await pill(hass)
    registry = er.async_get(hass)
    registry.async_get_or_create("sensor", "rapt_ble", "pill-specific_gravity", device_id=device.id)
    first, second = [(await create(hass, device.id))["result"] for _ in range(2)]
    batch = second.runtime_data
    end = dt_util.utcnow()
    batch.set_field("start", (end - timedelta(days=2)).timestamp())
    batch.set_field("end", end.timestamp())
    batch.set_field("initial_refractometer", 12)
    batch.set_field("final_hydrometer", 3)
    original = batch.values["final_abv"]
    old_entity = registry.async_get_entity_id("sensor", DOMAIN, f"{second.unique_id}_og")

    form = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": "reconfigure", "entry_id": second.entry_id}
    )
    result = await hass.config_entries.flow.async_configure(
        form["flow_id"], {"name": "Renamed", "wcf": 1.05}
    )
    await hass.async_block_till_done()
    assert result["reason"] == "reconfigure_successful"
    assert registry.async_get_entity_id("sensor", DOMAIN, f"{second.unique_id}_og") == old_entity
    assert second.title == "Renamed"
    assert first.data["wcf"] == 1.04
    assert second.runtime_data.values["applied_wcf"] == 1.05
    assert second.runtime_data.values["final_abv"] < original
    assert second.runtime_data.values["active"] is False
    assert second.data["initial_refractometer"] == 12


async def test_empty_controls_publish_icons(hass):
    device = await pill(hass)
    registry = er.async_get(hass)
    registry.async_get_or_create("sensor", "rapt_ble", "pill-specific_gravity", device_id=device.id)
    entry = (await create(hass, device.id))["result"]
    expected = {
        "hydrometer": "mdi:gauge",
        "sample_temperature": "mdi:thermometer",
        "refractometer": "mdi:angle-acute",
        "ph": "mdi:test-tube",
    }
    controls = {
        ("number", f"{stage}_{key}"): icon
        for stage in ("initial", "final")
        for key, icon in expected.items()
    }
    controls.update(
        {("datetime", "start"): "mdi:calendar-start", ("datetime", "end"): "mdi:calendar-end"}
    )
    for (domain, role), icon in controls.items():
        entity_id = registry.async_get_entity_id(domain, DOMAIN, f"{entry.unique_id}_{role}")
        state = hass.states.get(entity_id)
        assert state.state == "unknown"
        assert state.attributes["icon"] == icon
