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
  assert.equal(gravity.get(end), 4);
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
