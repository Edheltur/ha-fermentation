"""Expose dashboard resources and authorized fermentation entity references."""

from pathlib import Path

import probatio as vol
from homeassistant.auth.permissions.const import POLICY_READ
from homeassistant.components import websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.recorder import DATA_INSTANCE

from .const import DOMAIN


async def async_setup_dashboard(hass):
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                "/api/fermentation/static",
                str(Path(__file__).with_name("frontend")),
                False,
            )
        ]
    )
    websocket_api.async_register_command(hass, websocket_batches)


@websocket_api.websocket_command({vol.Required("type"): "fermentation/batches"})
@callback
def websocket_batches(hass, connection, msg):
    registry = er.async_get(hass)
    devices = dr.async_get(hass)
    batches = []
    for entry in hass.config_entries.async_entries(DOMAIN):
        if entry.disabled_by is not None:
            continue
        prefix = f"{entry.unique_id}_"
        roles = {
            entity.unique_id.removeprefix(prefix): entity.entity_id
            for entity in er.async_entries_for_config_entry(registry, entry.entry_id)
            if not entity.disabled
            and entity.unique_id.startswith(prefix)
            and connection.user.permissions.check_entity(entity.entity_id, POLICY_READ)
        }
        if not roles:
            continue
        device = devices.async_get_device_by_identifier((DOMAIN, entry.unique_id), entry.entry_id)
        batches.append(
            {
                "id": entry.unique_id,
                "name": (device and device.name_by_user) or entry.title,
                "device": device.id if device else None,
                "pill": entry.data.get("pill") if connection.user.is_admin else None,
                "start": entry.data.get("start"),
                "end": entry.data.get("end"),
                "wcf": entry.data.get("wcf"),
                "roles": roles,
            }
        )
    recorder = hass.data.get(DATA_INSTANCE)
    connection.send_result(
        msg["id"],
        {
            "batches": batches,
            "recorder": recorder is not None,
            "oldest": recorder.states_manager.oldest_ts if recorder else None,
        },
    )
