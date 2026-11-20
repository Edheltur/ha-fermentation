"""Set up a fermentation using registered RAPT Bluetooth sensors."""

from uuid import uuid4

import probatio as vol
from homeassistant.config_entries import ConfigFlow, OptionsFlow
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import selector as sel
from homeassistant.util import dt as dt_util

from .calculation import numeric
from .const import DOMAIN
from .report import Report

METADATA = {
    vol.Required("name"): str,
    vol.Optional("description"): sel.TextSelector({"multiline": True}),
    vol.Optional("wcf"): sel.NumberSelector({"mode": "box", "step": "any"}),
}


def sources(hass, device):
    candidates = {"sg": [], "temperature": []}
    for entry in er.async_entries_for_device(er.async_get(hass), device):
        if entry.platform != "rapt_ble" or entry.domain != "sensor" or entry.disabled:
            continue
        # RAPT's registry unique ID contains the instrument key, even after renaming.
        if "specific_gravity" in entry.unique_id.split("-"):
            candidates["sg"].append(entry.entity_id)
        elif entry.original_device_class == "temperature":
            candidates["temperature"].append(entry.entity_id)
    return candidates


def metadata_errors(data):
    errors = {}
    if not data["name"].strip():
        errors["name"] = "empty_name"
    if "wcf" in data and (numeric(data["wcf"]) or 0) <= 0:
        errors["wcf"] = "invalid_wcf"
    return errors


class FermentationFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    @staticmethod
    def async_get_options_flow(config_entry):
        return FermentationOptionsFlow()

    async def async_step_user(self, user_input=None):
        errors = {}
        if user_input is not None:
            errors = metadata_errors(user_input)
            self.candidates = sources(self.hass, user_input["pill"])
            if not self.candidates["sg"]:
                errors["pill"] = "missing_sg"
            if not errors:
                self.batch = dict(user_input)
                if any(len(ids) > 1 for ids in self.candidates.values()):
                    return await self.async_step_sources()
                return await self.finish({})
        entries = self._async_current_entries()
        last_wcf = entries[-1].data.get("wcf") if entries else 1.04
        schema = vol.Schema(
            {
                vol.Required("pill"): sel.DeviceSelector({"filter": {"integration": "rapt_ble"}}),
                **METADATA,
            }
        )
        return self.async_show_form(
            step_id="user",
            errors=errors,
            data_schema=self.add_suggested_values_to_schema(
                schema,
                user_input if user_input is not None else {"wcf": last_wcf} if last_wcf else {},
            ),
        )

    async def async_step_sources(self, user_input=None):
        choices = {role: ids for role, ids in self.candidates.items() if len(ids) > 1}
        if user_input is not None:
            return await self.finish(user_input)
        return self.async_show_form(
            step_id="sources",
            data_schema=vol.Schema(
                {
                    vol.Required(role): sel.SelectSelector({"options": ids})
                    for role, ids in choices.items()
                }
            ),
        )

    async def finish(self, chosen):
        registry = er.async_get(self.hass)
        current = sources(self.hass, self.batch["pill"])
        for role, ids in self.candidates.items():
            if ids:
                selected = chosen.get(role, ids[0])
                if selected not in current[role]:
                    return self.async_abort(reason="sources_changed")
                self.batch[role] = registry.async_get(selected).id
        await self.async_set_unique_id(str(uuid4()))
        title = self.batch.pop("name").strip()
        return self.async_create_entry(title=title, data=self.batch)

    async def async_step_reconfigure(self, user_input=None):
        entry = self._get_reconfigure_entry()
        errors = {}
        if user_input is not None:
            errors = metadata_errors(user_input)
            if not errors:
                data = {
                    **entry.data,
                    "description": user_input.get("description", ""),
                    "wcf": user_input.get("wcf"),
                }
                return self.async_update_reload_and_abort(
                    entry, title=user_input["name"].strip(), data=data
                )
        return self.async_show_form(
            step_id="reconfigure",
            errors=errors,
            data_schema=self.add_suggested_values_to_schema(
                vol.Schema(METADATA),
                user_input
                or {
                    "name": entry.title,
                    **{
                        k: entry.data[k]
                        for k in ("description", "wcf")
                        if entry.data.get(k) is not None
                    },
                },
            ),
        )


class FermentationOptionsFlow(OptionsFlow):
    async def async_step_init(self, user_input=None):
        return self.async_show_menu(step_id="init", menu_options=["report"])

    async def async_step_report(self, user_input=None):
        if user_input is not None:
            # Closing the form must not overwrite the config entry's options.
            return self.async_abort(reason="report_closed")
        entry = self.config_entry
        config = self.hass.config
        report = Report(
            entry.title,
            entry.data,
            dt_util.utcnow().timestamp(),
            config.time_zone,
            config.language,
            entry.runtime_data.values,
        ).render()
        return self.async_show_form(
            step_id="report",
            data_schema=self.add_suggested_values_to_schema(
                vol.Schema({vol.Optional("report"): sel.TextSelector({"multiline": True})}),
                {"report": report},
            ),
        )
