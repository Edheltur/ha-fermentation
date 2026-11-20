import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultBatch, historyWindow, loadHistory } from "../custom_components/fermentation/frontend/history.js";

const HOUR = 3_600_000;
const DAY = HOUR * 24;
const end = 40 * DAY;
const series = [
  { entity: "sensor.gravity", role: "brix" },
  { entity: "sensor.temp", role: "temperature" },
];

test("selects the most recent active batch, then finished, then planned", () => {
  const a = { start: 1, end: 5 };
  const b = { start: 5, end: 10 };
  const c = { start: 6, end: 20 };
  const d = { start: null, end: null };
  assert.equal(defaultBatch([b, c, a, d], 8000), c);
  assert.equal(defaultBatch([c, b, a, d], 21000), c);
  assert.equal(defaultBatch([c, b, d], 1000), b);
  assert.equal(defaultBatch([d], 1000), d);
  assert.equal(defaultBatch([d, { ...d }], 1000), null);
  assert.deepEqual(historyWindow({ start: 1, end: 5 }, 1, 8000), [1000, 5000]);
});

test("detailed history holds stable values and keeps an explicit gap", async () => {
  const start = end - DAY;
  const coverage = { recorder: true, oldest: (end - 30 * DAY) / 1000 };
  const hass = {
    async callWS(message) {
      assert.equal(message.type, "history/history_during_period");
      assert.equal(message.significant_changes_only, false);
      return {
        "sensor.gravity": [
          { lu: start / 1000, s: "8" },
          { lu: (start + HOUR) / 1000, s: "unavailable" },
          { lu: (start + 2 * HOUR) / 1000, s: "4" },
          { lu: (start + 3 * HOUR) / 1000, s: "5" },
        ],
        "sensor.temp": [{ lu: start / 1000, s: "68", a: { unit_of_measurement: "°F" } }],
      };
    },
  };
  const result = await loadHistory(hass, series, start, end, coverage);
  assert.equal(result.hourly, false);
  const [gravity, temperature] = result.series.map(({ points }) => new Map(points));
  assert.equal(gravity.get(start + HOUR - 1), 8);
  assert.equal(gravity.get(start + HOUR), null);
  assert.equal(gravity.get(start + 2 * HOUR - 1), null);
  assert.equal(gravity.get(start + 3 * HOUR), 5);
  assert.equal(gravity.has(start + 3 * HOUR - 1), false);
  assert.equal(gravity.get(end), 5);
  assert.equal(temperature.get(start + HOUR), 20);
  assert.equal(temperature.get(end), 20);
});

test("windows before retention use only hour means and do not fill missing buckets", async () => {
  const start = end - 35 * DAY;
  const coverage = { recorder: true, oldest: (end - 30 * DAY) / 1000 };
  const hass = {
    async callWS(message) {
      assert.equal(message.type, "recorder/statistics_during_period");
      assert.equal(message.period, "hour");
      return {
        "sensor.gravity": [
          { start, end: start + HOUR, mean: 8 },
          { start: start + 2 * HOUR, end: start + 3 * HOUR, mean: 4 },
        ],
      };
    },
  };
  const result = await loadHistory(hass, series, start, end, coverage);
  assert.equal(result.hourly, true);
  assert.equal(result.series.length, 1);
  const gravity = new Map(result.series[0].points);
  assert.equal(gravity.get(start + HOUR), null);
  assert.equal(gravity.get(start + 2 * HOUR), 4);
  assert.equal(gravity.get(end), null);
});

test("empty history leaves the chart empty", async () => {
  const hass = { callWS: async () => ({}) };
  const result = await loadHistory(hass, series, end - DAY, end, { recorder: true, oldest: null });
  assert.deepEqual(result.series, []);
});

test("long history keeps extrema and unavailable boundaries within the point budget", async () => {
  const start = end - 30 * DAY;
  const minute = 60_000;
  const gap = start + 42 * minute;
  const recovery = gap + 3 * minute;
  const peak = start + 50 * minute;
  const states = Array.from({ length: 30 * 24 * 60 }, (_, i) => ({
    lu: (start + i * minute) / 1000,
    s: i >= 42 && i < 45 ? "unavailable" : i === 50 ? "50" : String(10 + i % 13 / 10),
  }));
  const hass = { callWS: async () => ({ "sensor.gravity": states }) };
  const { series: [gravity] } = await loadHistory(hass, series.slice(0, 1), start, end,
    { recorder: true, oldest: start / 1000 });
  assert.ok(gravity.points.length < 1000, `got ${gravity.points.length} points`);
  const points = new Map(gravity.points);
  assert.equal(points.get(gap - 1), Number(states[41].s));
  assert.equal(points.get(gap), null);
  assert.equal(points.get(recovery - 1), null);
  assert.equal(points.get(recovery), Number(states[45].s));
  assert.equal(points.get(peak), 50);
});

test("minute refresh reads a short overlap and retains earlier history", async () => {
  const start = end - DAY;
  const coverage = { recorder: true, oldest: start / 1000 };
  const minute = 60_000;
  const ids = series.slice(0, 1);
  const queries = [];
  const hass = {
    async callWS(message) {
      const since = Date.parse(message.start_time);
      queries.push(since);
      return { "sensor.gravity": [
        { lu: since / 1000, s: since === start ? "8" : "6" },
        { lu: (since === start ? end - HOUR : end + 1000) / 1000, s: since === start ? "6" : "5" },
      ] };
    },
  };
  const first = await loadHistory(hass, ids, start, end, coverage);
  const second = await loadHistory(hass, ids, start + minute, end + minute, coverage, first.snapshot);
  assert.deepEqual(queries, [start, end - 2 * minute]);
  const points = new Map(second.series[0].points);
  assert.equal(points.get(start + minute), 8);
  assert.equal(points.get(end - HOUR), 6);
  assert.equal(points.get(end + minute), 5);
});

test("hourly history is reused within the hour and refreshed at the boundary", async () => {
  const start = end - 35 * DAY;
  const coverage = { recorder: true, oldest: (end - 30 * DAY) / 1000 };
  const queries = [];
  const hass = {
    async callWS(message) {
      const since = Date.parse(message.start_time);
      queries.push(since);
      return { "sensor.gravity": [{ start: since, end: since + HOUR, mean: 8 }] };
    },
  };
  const first = await loadHistory(hass, series, start, end, coverage);
  const second = await loadHistory(hass, series, start, end + HOUR / 2, coverage, first.snapshot);
  const third = await loadHistory(hass, series, start, end + HOUR, coverage, second.snapshot);
  assert.deepEqual(queries, [start, end - HOUR]);
  assert.equal(new Map(third.series[0].points).get(start), 8);
  assert.equal(new Map(third.series[0].points).get(end - HOUR), 8);
});
