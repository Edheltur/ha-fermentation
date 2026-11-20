const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const DETAIL_OVERLAP = 120_000;
const DISPLAY_BUCKETS = 240;

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
    if (!points.has(row.end)) points.set(row.end, null);
  }
  return points;
}

function appendChanges(previous, incoming, start, since) {
  const changes = new Map();
  let held = null;
  for (const [time, value] of previous ?? []) {
    if (time >= since) break;
    if (time < start) {
      held = value;
    } else {
      if (held !== null && time > start && !changes.size) changes.set(start, held);
      changes.set(time, value);
    }
  }
  if (held !== null && !changes.size) changes.set(start, held);
  for (const [time, value] of [...incoming].sort(([a], [b]) => a - b)) {
    changes.set(time, value);
  }
  return changes;
}

function visibleTimes(changes, start, end, times) {
  let previous = null;
  let bucketId = -1;
  let min, max;
  const finishBucket = () => {
    if (!min) return;
    times.add(min[0]);
    times.add(max[0]);
  };
  for (const [time, value] of changes) {
    if (time > end) break;
    if ((value === null) !== (previous === null)) {
      times.add(time);
      if (time > start) times.add(time - 1);
    }
    previous = value;
    if (value === null) continue;
    const bucket = Math.floor((time - start) * DISPLAY_BUCKETS / (end - start));
    if (bucket !== bucketId) {
      finishBucket();
      bucketId = bucket;
      min = max = [time, value];
    } else {
      if (value < min[1]) min = [time, value];
      if (value > max[1]) max = [time, value];
    }
  }
  finishBucket();
}

function alignSeries(series, start, end) {
  const times = new Set([start, end - 1, end]);
  for (const { changes } of series) visibleTimes(changes, start, end, times);
  const timeline = [...times].sort((a, b) => a - b);
  return series.map(({ changes, ...item }) => {
    const entries = changes.entries();
    let next = entries.next();
    let value = null;
    const points = timeline.map((time) => {
      while (!next.done && next.value[0] <= time) {
        value = next.value[1];
        next = entries.next();
      }
      return [time, value];
    });
    return { ...item, points };
  });
}

export async function loadHistory(hass, series, start, end, coverage, previous) {
  if (!series.length || !coverage.recorder || start >= end) return { hourly: false, series: [] };
  const ids = series.map(({ entity }) => entity);
  const end_time = new Date(end).toISOString();
  let hourly = coverage.oldest !== null && start < coverage.oldest * 1000;
  let changes = [];
  if (!hourly) {
    const cached = previous && !previous.hourly ? previous : null;
    const since = cached ? Math.max(start, cached.end - DETAIL_OVERLAP) : start;
    const result = await hass.callWS({
      type: "history/history_during_period",
      start_time: new Date(since).toISOString(),
      end_time,
      entity_ids: ids,
      significant_changes_only: false,
    });
    changes = series.map((item) => ({
      ...item,
      changes: appendChanges(cached?.changes.get(item.entity),
        detailedPoints(result[item.entity] ?? [], item.role, since, end), start, since),
    }));
    // Entity history can also be purged independently of global retention.
    hourly = !changes.some(({ changes }) => changes.size);
  }
  if (hourly) {
    const cached = previous?.hourly ? previous : null;
    const hour = Math.floor(end / HOUR);
    const since = cached ? Math.max(start, (Math.floor(cached.end / HOUR) - 1) * HOUR) : start;
    const result = !cached || hour !== Math.floor(cached.end / HOUR)
      ? await hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: new Date(Math.floor(since / HOUR) * HOUR).toISOString(),
        end_time,
        statistic_ids: ids, period: "hour", types: ["mean"], units: { temperature: "°C" },
      }) : null;
    changes = series.map((item) => ({
      ...item,
      changes: appendChanges(cached?.changes.get(item.entity), result
        ? hourlyPoints(result[item.entity] ?? [], since, end) : [], start, result ? since : Infinity),
    }));
  }
  const plotted = changes.filter(({ changes }) => [...changes.values()].some((value) => value !== null));
  return { hourly, series: alignSeries(plotted, start, end),
    snapshot: { hourly, end, changes: new Map(changes.map(({ entity, changes }) => [entity, changes])) } };
}
