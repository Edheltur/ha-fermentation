const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const SERIES = [
  { role: "brix", color: "#2196f3", unit: "°Bx", precision: 2 },
  { role: "temperature", color: "#ff9800", unit: "°C", precision: 1 },
  { role: "abv", color: "#4caf50", unit: "%", precision: 1 },
];

export function number(value) {
  return value != null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
}

export function celsius(value, unit) {
  if (value === null) return null;
  if (unit === "°F") return (value - 32) * 5 / 9;
  if (unit === "K") return value - 273.15;
  return unit === "°C" ? value : null;
}

export function batchStatus(batch, now) {
  if (batch.start == null || batch.start * 1000 > now) return "scheduled";
  return batch.end != null && batch.end * 1000 <= now ? "finished" : "active";
}

export function defaultBatch(batches, now) {
  const status = (key) => batches.filter((batch) => batchStatus(batch, now) === key);
  return status("active").sort((a, b) => b.start - a.start)[0]
    ?? status("finished").sort((a, b) => b.end - a.end)[0]
    ?? status("scheduled").filter((batch) => batch.start != null).sort((a, b) => a.start - b.start)[0]
    ?? (batches.length === 1 ? batches[0] : null);
}

export function historyWindow(batch, days, now) {
  const end = Math.round(Math.min(batch.end == null ? now : batch.end * 1000, now));
  return [Math.max(Math.round(batch.start * 1000), days ? end - days * DAY : -Infinity), end];
}

function detailedPoints(states, role, start, end) {
  const points = new Map();
  for (const state of states) {
    const time = Math.max(start, Math.round(state.lu * 1000));
    if (!Number.isFinite(time) || time >= end) continue;
    const value = number(state.s);
    points.set(time, role === "temperature" ? celsius(value, state.a?.unit_of_measurement) : value);
  }
  return points;
}

function hourlyPoints(rows, start, end) {
  const points = new Map();
  for (const row of rows) {
    if (row.end <= start || row.start >= end) continue;
    points.set(Math.max(start, row.start), number(row.mean));
    if (!points.has(row.end) && row.end < end) points.set(row.end, null);
  }
  return points;
}

function alignSeries(series, start, end) {
  const times = new Set([start, end - 1, end]);
  for (const { changes } of series) {
    for (const time of changes.keys()) {
      times.add(time);
      // End a held value just before a gap or a state change.
      if (time > start) times.add(time - 1);
    }
  }
  const timeline = [...times].sort((a, b) => a - b);
  return series.map(({ changes, ...item }) => {
    let value = null;
    const points = timeline.map((time) => {
      if (changes.has(time)) value = changes.get(time);
      return [time, value];
    });
    return { ...item, points };
  });
}

export async function loadHistory(hass, series, start, end, coverage) {
  if (!series.length || !coverage.recorder || start >= end) return { hourly: false, series: [] };
  const range = { start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString() };
  const ids = series.map(({ entity }) => entity);
  let hourly = coverage.oldest !== null && start < coverage.oldest * 1000;
  let changes = [];
  if (!hourly) {
    const result = await hass.callWS({
      type: "history/history_during_period",
      ...range,
      entity_ids: ids,
      significant_changes_only: false,
    });
    changes = series.map((item) => ({
      ...item, changes: detailedPoints(result[item.entity] ?? [], item.role, start, end),
    }));
    // Entity history can also be purged independently of global retention.
    hourly = !changes.some(({ changes }) => changes.size);
  }
  if (hourly) {
    const result = await hass.callWS({
      type: "recorder/statistics_during_period",
      ...range,
      start_time: new Date(Math.floor(start / HOUR) * HOUR).toISOString(),
      statistic_ids: ids, period: "hour", types: ["mean"], units: { temperature: "°C" },
    });
    changes = series.map((item) => ({
      ...item, changes: hourlyPoints(result[item.entity] ?? [], start, end),
    }));
  }
  const plotted = changes.filter(({ changes }) => [...changes.values()].some((value) => value !== null));
  return { hourly, series: alignSeries(plotted, start, end) };
}
