"""Lifecycle and minute samples of one fermentation."""

from datetime import UTC, datetime

from homeassistant.core import callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import (
    async_track_point_in_utc_time,
    async_track_state_change_event,
    async_track_utc_time_change,
)
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util
from homeassistant.util.unit_conversion import TemperatureConverter

from .calculation import DAY, WINDOW, brix, daily_delta, manual_results, numeric, sg_reading
from .const import DOMAIN


def sample_store(hass, entry):
    return Store(hass, 1, f"{DOMAIN}.{entry.unique_id}.samples")


def contains(data, timestamp):
    start, end = data.get("start"), data.get("end")
    return start is not None and start <= timestamp and (end is None or timestamp < end)


class Batch:
    def __init__(self, hass, entry):
        self.hass = hass
        self.entry = entry
        self.store = sample_store(hass, entry)
        self.points = []
        self.listeners = set()
        self.timers = []
        self.unsubscribe = None
        self.values = {}
        self.delta = None

    @property
    def data(self):
        return self.entry.data

    async def load(self):
        stored = await self.store.async_load() or []
        self.points = [(t, sg) for t, value in stored if (sg := sg_reading(value)) is not None]
        self.reschedule()

    def stop(self):
        for cancel in self.timers:
            cancel()
        self.timers.clear()
        if self.unsubscribe:
            self.unsubscribe()
            self.unsubscribe = None

    @callback
    def reschedule(self, boundary_time=None):
        self.stop()
        now = dt_util.utcnow()
        timestamp = now.timestamp()
        self.trim(timestamp)
        self.delta = daily_delta(self.points, int(timestamp // 60) * 60)
        for key in ("start", "end"):
            boundary = self.data.get(key)
            if boundary is not None and boundary > timestamp:
                self.timers.append(
                    async_track_point_in_utc_time(
                        self.hass, self.reschedule, datetime.fromtimestamp(boundary, UTC)
                    )
                )
                break
        if contains(self.data, timestamp):
            self.subscribe_sources()
            self.timers.extend(
                [
                    self.hass.bus.async_listen(
                        er.EVENT_ENTITY_REGISTRY_UPDATED, self.registry_changed
                    ),
                    async_track_utc_time_change(self.hass, self.sample, second=0),
                ]
            )
            # An exact-minute scheduled start owns the first sample on a shared boundary.
            minute = int(timestamp // 60) * 60
            if boundary_time and boundary_time.timestamp() == self.data["start"] == minute:
                self.sample(now)
                return
        self.refresh()

    def source_ids(self):
        registry = er.async_get(self.hass)
        return {
            role: entity.entity_id
            for role in ("sg", "temperature")
            if (key := self.data.get(role)) and (entity := registry.async_get(key))
        }

    def subscribe_sources(self):
        if self.unsubscribe:
            self.unsubscribe()
        ids = list(self.source_ids().values())
        self.unsubscribe = (
            async_track_state_change_event(self.hass, ids, self.refresh) if ids else None
        )

    @callback
    def registry_changed(self, event):
        ids = self.source_ids().values()
        if event.data["entity_id"] in ids or event.data.get("old_entity_id") in ids:
            self.subscribe_sources()
            self.refresh()

    def reading(self, role):
        entity_id = self.source_ids().get(role)
        state = self.hass.states.get(entity_id) if entity_id else None
        if state is None:
            return None
        if role == "sg":
            return sg_reading(state.state)
        value = numeric(state.state)
        if role == "temperature" and value is not None:
            unit = state.attributes.get("unit_of_measurement")
            if unit not in TemperatureConverter.VALID_UNITS:
                return None
            return TemperatureConverter.convert(value, unit, "°C")
        return value

    def trim(self, now):
        self.points = [
            (t, sg)
            for t, sg in self.points
            if now - DAY - WINDOW < t <= now and contains(self.data, t)
        ]

    @callback
    def sample(self, now):
        timestamp = int(now.timestamp() // 60) * 60
        if not contains(self.data, timestamp):
            return
        self.trim(timestamp)
        sg = self.reading("sg")
        if sg is not None and (not self.points or self.points[-1][0] < timestamp):
            self.points.append((timestamp, sg))
        self.delta = daily_delta(self.points, timestamp)
        self.store.async_delay_save(lambda: self.points, 1)
        self.refresh()

    @callback
    def refresh(self, _event=None):
        now = dt_util.utcnow().timestamp()
        active = contains(self.data, now)
        start, end = self.data.get("start"), self.data.get("end")
        sg = self.reading("sg") if active else None
        manual = manual_results(self.data)
        og = manual["og"]
        self.values = {
            **manual,
            "active": active,
            "sg": sg,
            "duration": int(min(now, end if end is not None else now) - start)
            if start is not None and start <= now
            else None,
            "brix": brix(sg) if sg is not None else None,
            "temperature": self.reading("temperature") if active else None,
            "abv": (og - sg) * 131.25 if sg is not None and og is not None else None,
            "delta": self.delta if sg is not None else None,
        }
        for listener in tuple(self.listeners):
            listener()

    @callback
    def set_field(self, key, value):
        data = {**self.data, key: value}
        if key in ("start", "end"):
            self.validate_interval(data)
        # Validation and update run on the HA event loop without yielding.
        self.hass.config_entries.async_update_entry(self.entry, data=data)
        if key in ("start", "end"):
            self.reschedule()
            self.store.async_delay_save(lambda: self.points, 1)
        else:
            self.refresh()

    def validate_interval(self, data):
        start, end = data.get("start"), data.get("end")
        error = None
        if end is not None and (start is None or end <= start):
            error = "invalid_interval"
        elif start is not None:
            for entry in self.hass.config_entries.async_entries(DOMAIN):
                other = entry.data
                if (
                    entry is self.entry
                    or other["pill"] != data["pill"]
                    or other.get("start") is None
                ):
                    continue
                if (end is None or other["start"] < end) and (
                    other.get("end") is None or start < other["end"]
                ):
                    error = "overlap"
                    break
        if error:
            raise ServiceValidationError(translation_domain=DOMAIN, translation_key=error)
