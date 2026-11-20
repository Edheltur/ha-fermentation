import { batchStatus, defaultBatch, historyWindow, loadHistory, number, SERIES } from "./history.js";

const TEXT = {
  ru: {
    scheduled: "Брожение ещё не началось",
    active: (elapsed) => `Брожение идёт ${elapsed}`,
    finished: (elapsed) => `Брожение завершено за ${elapsed}`,
    remaining: (left) => `осталось ${left}`,
    choose: "Выберите ферментацию", empty: "Нет доступных ферментаций",
    delta: "Изменение плотности за 24 часа",
    brix: "Плотность", temperature: "Температура", chartAbv: "Алкоголь",
    period: "Период графика", fullHistory: "Полная история", loading: "Загрузка истории…",
    noHistory: "Нет записанной истории",
    apex: "Установите и загрузите ресурс apexcharts-card для просмотра графика.",
    error: "Не удалось загрузить данные", historyError: "Не удалось загрузить историю",
    start: "Старт", finish: "Финиш", setStart: "Указать старт", setFinish: "Указать финиш",
    samples: "Ручные пробы", hydrometer: "АС-3, °Bx", sample_temperature: "Температура пробы, °C",
    refractometer: "Рефрактометр, °Bx", ph: "pH", clear: "Очистить значение",
    confirmClear: "Очистить это значение пробы?", clearError: "Не удалось очистить значение пробы",
    outsideTable: "Вне таблицы поправок АС-3", attenuation: "Видимая степень сбраживания",
    final_abv: "Алкоголь по АС-3", refractometer_abv: "Алкоголь по рефрактометру",
    ogSource: "Источник OG", workingWcf: "Рабочий WCF",
    sampleWcf: "WCF по начальной пробе", hydrometerSource: "АС-3",
    refractometerSource: "Рефрактометр", device: "Устройство ферментации", pill: "Устройство Pill",
    pending: "Загрузка ферментаций…", save: "Сохранить", cancel: "Отмена",
    dateError: "Не удалось сохранить дату",
  },
  en: {
    scheduled: "Fermentation has not started",
    active: (elapsed) => `Fermenting for ${elapsed}`,
    finished: (elapsed) => `Fermentation completed in ${elapsed}`,
    remaining: (left) => `${left} left`,
    choose: "Select a fermentation", empty: "No available fermentations",
    delta: "Gravity change over 24 hours",
    brix: "Gravity", temperature: "Temperature", chartAbv: "ABV",
    period: "Chart period", fullHistory: "Full history", loading: "Loading history…",
    noHistory: "No recorded history",
    apex: "Install and load the apexcharts-card resource to view the chart.",
    error: "Could not load data", historyError: "Could not load history",
    start: "Start", finish: "Finish", setStart: "Set start", setFinish: "Set finish",
    samples: "Manual samples", hydrometer: "AS-3, °Bx", sample_temperature: "Sample temperature, °C",
    refractometer: "Refractometer, °Bx", ph: "pH", clear: "Clear value",
    confirmClear: "Clear this sample value?", clearError: "Could not clear the sample value",
    outsideTable: "Outside the AS-3 correction table", attenuation: "Apparent attenuation",
    final_abv: "AS-3 ABV", refractometer_abv: "Refractometer ABV",
    ogSource: "OG source", workingWcf: "Working WCF",
    sampleWcf: "WCF from initial sample", hydrometerSource: "AS-3",
    refractometerSource: "Refractometer", device: "Fermentation device", pill: "Pill device",
    pending: "Loading fermentations…", save: "Save", cancel: "Cancel",
    dateError: "Could not save the date",
  },
};

const PROBES = ["hydrometer", "sample_temperature", "refractometer", "ph"];
const PERIODS = [1, 3, 10, null];
const REFRESH = 60_000;
const MIN_CHART_HEIGHT = 260;
const Y_AXIS_TICKS = 4;
const MIN_Y_SPAN = { brix: 2, temperature: 4, abv: 2 };
const ABV_RU = "% об.";

function node(tag, text = null, className = "") {
  const el = document.createElement(tag);
  if (text !== null) el.textContent = text;
  if (className) el.className = className;
  return el;
}

function button(text, action, disabled = false) {
  const el = node("button", text);
  el.type = "button";
  el.disabled = disabled;
  el.addEventListener("click", action);
  return el;
}

function actionBadge(text, action) {
  const badge = node("ha-badge", text);
  if (!action) return badge;

  badge.type = "button";
  badge.addEventListener("click", action);
  badge.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (!event.repeat) badge.click();
  });
  return badge;
}

function durationText(seconds, locale, style = "long") {
  const totalHours = Math.max(0, Math.floor(seconds / 3600));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (Intl.DurationFormat) {
    return new Intl.DurationFormat(locale, { style, hoursDisplay: days ? "auto" : "always" })
      .format({ days, hours });
  }

  const unitText = (value, unit) => new Intl.NumberFormat(locale, {
    style: "unit", unit, unitDisplay: style,
  }).format(value);
  const parts = [];
  if (days) parts.push(unitText(days, "day"));
  if (hours || !days) parts.push(unitText(hours, "hour"));
  return new Intl.ListFormat(locale, { style, type: "unit" }).format(parts);
}

function fermentationStatus(batch, status, now, t, locale) {
  if (status === "scheduled") return t.scheduled;

  const compact = (seconds) => durationText(seconds, locale, "narrow").replace("д.", "д");
  if (status === "finished") return t.finished(compact(batch.end - batch.start));

  const elapsed = t.active(compact(now - batch.start));
  return batch.end == null ? elapsed : `${elapsed}, ${t.remaining(compact(batch.end - now))}`;
}

function chartSeriesName(t, role) {
  return role === "abv" ? t.chartAbv : t[role];
}

function chartHeight() {
  // ApexCharts expects a numeric height in pixels.
  return Math.max(MIN_CHART_HEIGHT, Math.ceil(window.innerHeight / 2));
}

function minimumAxisBounds({ role, points }) {
  let low = Infinity;
  let high = -Infinity;
  for (const [, value] of points) {
    if (!Number.isFinite(value)) continue;
    low = Math.min(low, value);
    high = Math.max(high, value);
  }

  const span = MIN_Y_SPAN[role];
  if (low === Infinity || high - low >= span) return { min: undefined, max: undefined };

  const step = span / Y_AXIS_TICKS;
  const min = Math.floor((low + (high - low - span) / 2) / step) * step;
  return { min, max: Math.max(min + span, Math.ceil(high / step) * step) };
}

function chartConfig(series, start, end, t, locale, timeZone, period, active) {
  // Anchor span.offset to a calendar boundary so a finished chart does not drift.
  const base = new Date(new Date().getFullYear(), 0, 1).getTime();
  const offset = start - base;
  // ApexCharts Card serializes its configuration and evaluates EVAL formatters after loading it.
  const dateFormat = (options) => `new Intl.DateTimeFormat(${JSON.stringify(locale)},
    ${JSON.stringify({ timeZone, ...options })}).format`;
  const numberOptions = (precision) => ({
    minimumFractionDigits: precision, maximumFractionDigits: precision,
  });
  const numberFormat = (precision, options = numberOptions(precision)) => `new Intl.NumberFormat(${JSON.stringify(locale)},
    ${JSON.stringify(options)}).format`;
  const date = { day: "numeric", month: "short" };
  const time = { hour: "2-digit", minute: "2-digit" };
  // Keep the end labels inside the chart even when all Y axes are hidden.
  const axisPadding = 17;
  const seriesUnits = series.map(({ unit }) => unit);
  const seriesNumberOptions = series.map(({ precision }) => numberOptions(precision));
  return {
    type: "custom:apexcharts-card",
    graph_span: `${end - start}ms`,
    span: { start: "year", offset: `${offset >= 0 ? "+" : ""}${offset}ms` },
    header: { show: false },
    series: series.map(({ role, entity, color, precision }) => ({
      entity, name: chartSeriesName(t, role), color, float_precision: precision,
      stroke_width: 1.5, stroke_dash: role === "abv" ? 5 : 0, curve: "smooth",
      extend_to: false, data_generator: "return entity.attributes.fermentation_points;",
    })),
    apex_config: {
      stroke: { lineCap: "round" },
      chart: {
        height: chartHeight(), toolbar: { show: false }, zoom: { enabled: false }, animations: { enabled: false },
        events: {
          updated: `EVAL:function(chart) {
            chart.el.dispatchEvent(new CustomEvent("fermentation-chart-ready", {
              detail: chart, bubbles: true, composed: true
            }));
          }`,
        },
      },
      grid: {
        borderColor: "color-mix(in srgb, var(--primary-text-color) 25%, transparent)",
        padding: { left: axisPadding, right: axisPadding },
      },
      yaxis: series.map(({ role, color, precision, points }) => ({
        ...minimumAxisBounds({ role, points }),
        seriesName: chartSeriesName(t, role), opposite: role !== "brix",
        showAlways: false, decimalsInFloat: precision, tickAmount: Y_AXIS_TICKS,
        labels: {
          // A positive offset moves the right-side labels toward the plot.
          offsetX: role === "abv" ? 14 : 0,
          style: { colors: color },
          formatter: `EVAL:${numberFormat(precision, { maximumFractionDigits: precision })}`,
        },
      })),
      legend: {
        show: true, position: "bottom", onItemClick: { toggleDataSeries: true },
        formatter: `EVAL:function(name, { seriesIndex, w }) {
          const unit = ${JSON.stringify(seriesUnits)}[seriesIndex];
          const point = w.config.series[seriesIndex]?.data?.at(-1);
          const value = Array.isArray(point) ? point[1] : point?.y;
          if (!${active}) return name + ' · ' + unit;
          const options = ${JSON.stringify(seriesNumberOptions)}[seriesIndex];
          const formatted = Number.isFinite(value)
            ? new Intl.NumberFormat(${JSON.stringify(locale)}, options).format(value) : '—';
          return name + ': ' + formatted + ' ' + unit;
        }`,
      },
      xaxis: {
        axisBorder: { color: "var(--secondary-text-color)" },
        axisTicks: { color: "var(--secondary-text-color)" },
        labels: {
          rotate: 0, showDuplicates: false, hideOverlappingLabels: true,
          formatter: `EVAL:function(_value, timestamp) {
            const format = ${dateFormat(period === 1 ? time : { ...date, month: "numeric" })};
            return Number.isFinite(timestamp) ? format(timestamp) : '';
          }`,
        },
      },
      tooltip: {
        shared: true, intersect: false, hideEmptySeries: false,
        x: { formatter: `EVAL:${dateFormat({ ...date, ...time })}` },
        y: series.map(({ unit, precision }) => ({
          formatter: `EVAL:function(value) {
            return Number.isFinite(value)
              ? (${numberFormat(precision)})(value) + ${JSON.stringify(` ${unit}`)}
              : '—';
          }`,
        })),
      },
    },
  };
}

class FermentationCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.batches = [];
    this.period = 3;
    const style = node("style");
    style.textContent = `
      :host { display: block; min-width: 0; }
      ha-card { display: block; padding: 16px; overflow: hidden; }
      h2 { margin: 0; font-size: 1.25rem; overflow-wrap: anywhere; }
      p { margin: 8px 0; }
      p[role="status"]:empty { margin: 0; }
      button { font: inherit; color: inherit;
        border: 1px solid var(--ha-color-border-neutral-quiet, var(--divider-color));
        border-radius: 8px; background: var(--ha-color-form-background, transparent);
        padding: 5px 7px; min-height: 36px; cursor: pointer; }
      button:disabled { opacity: .5; cursor: default; }
      ha-control-select-menu { display: block; }
      .muted, small { color: var(--secondary-text-color); }
      .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 78px), 1fr));
        gap: 6px; margin: 14px 0; }
      .metric { display: grid; gap: 4px; align-content: start; padding: 8px 6px; text-align: center;
        background: var(--secondary-background-color); border-radius: 8px; overflow-wrap: anywhere; }
      .metric strong { font-size: 1.05rem; }
      .chart { min-width: 0; margin-inline: -14px; }
      .dates {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr));
        gap: 6px;
        margin: 12px 0;
        --ha-badge-size: 44px;
      }
      ha-expansion-panel {
        --input-fill-color: transparent;
        --expansion-panel-summary-padding: 0;
        --expansion-panel-content-padding: 0;
        margin-top: 4px;
      }
      .samples-table, .samples-table thead, .samples-table tbody {
        display: grid;
        gap: 6px;
      }
      .samples-table tr {
        display: grid;
        grid-template-columns: minmax(0, 1.1fr) repeat(2, minmax(0, 1fr));
        align-items: start;
        gap: 6px;
      }
      .samples-table th, .samples-table td {
        min-width: 0;
        text-align: start;
        overflow-wrap: anywhere;
      }
      .samples-table tbody th { align-self: center; }
      .samples-table td { container-type: inline-size; }
      .sample-actions {
        display: grid;
        justify-items: start;
        gap: 4px;
      }
      @container (min-width: 96px) {
        .sample-actions {
          grid-template-columns: fit-content(100%) auto;
          justify-content: start;
          align-items: center;
        }
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      ha-tip { display: block; margin-top: 12px; }
      a { color: var(--primary-color); }
      dialog { box-sizing: border-box; width: min(360px, calc(100vw - 32px)); padding: 16px;
        border: 1px solid var(--divider-color); border-radius: 12px; color: var(--primary-text-color);
        background: var(--card-background-color); }
      dialog::backdrop { background: rgb(0 0 0 / 45%); }
      dialog form { display: grid; gap: 12px; }
      dialog input { box-sizing: border-box; width: 100%; margin-top: 4px; font: inherit; }
      .dialog-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
      [hidden] { display: none !important; }
    `;
    const card = node("ha-card");
    this.statusLabel = node("p", null, "muted");
    this.densityChange = node("p", null, "muted");
    this.picker = node("ha-control-select-menu");
    this.picker.showArrow = true;
    this.picker.addEventListener("wa-select", (event) => this.selectBatch(event.detail.item.value));
    this.message = node("p", null, "muted");
    this.summary = node("section", null, "metrics");
    this.graph = node("section");
    this.periodControl = node("ha-control-select");
    this.periodControl.addEventListener("value-changed", (event) => {
      const { value } = event.detail;
      this.period = value === "all" ? null : Number(value);
      this.render();
    });
    this.historyMessage = node("p", null, "muted");
    this.historyMessage.setAttribute("role", "status");
    this.chart = node("div", null, "chart");
    this.graph.append(this.periodControl, this.historyMessage, this.chart);
    this.results = node("section", null, "metrics");
    this.dates = node("section", null, "dates");
    this.samples = node("ha-expansion-panel");
    this.sampleValues = node("div");
    this.samples.append(this.sampleValues);
    this.details = node("ha-tip");
    this.diagnostic = node("span");
    this.editError = node("p");
    this.editError.setAttribute("role", "alert");
    this.links = node("span");
    this.details.append(this.diagnostic, " ", this.links);
    this.sections = node("div");
    this.sections.append(this.summary, this.graph, this.results, this.dates, this.samples,
      this.editError, this.details);
    card.append(this.picker, this.statusLabel, this.densityChange, this.message, this.sections);
    this.shadowRoot.append(style, card);
  }

  setConfig(_config) {}

  getCardSize() { return 7; }

  connectedCallback() {
    window.addEventListener("resize", this.resizeChart);
    this.watchConnection();
    this.refreshBatches();
    this.timer = setInterval(async () => {
      await this.refreshBatches();
      if (!this.batchesError && this.chartStatus === "active") this.refreshGraph(true);
    }, REFRESH);
    customElements.whenDefined("apexcharts-card").then(() => this.refreshGraph(true));
  }

  disconnectedCallback() {
    window.removeEventListener("resize", this.resizeChart);
    clearInterval(this.timer);
    clearTimeout(this.registryTimer);
    this.watchConnection(null);
    this.pendingChart = null;
    this.dateDialog?.close();
  }

  set hass(hass) {
    const previous = this._hass;
    this._hass = hass;
    if (!this.isConnected) return;
    if (previous?.connection !== hass.connection) {
      this.watchConnection();
      this.pendingChart = null;
      this.chartKey = null;
      this.historySnapshot = null;
      this.refreshBatches();
    }
    if (previous?.devices !== hass.devices || previous?.entities !== hass.entities) {
      clearTimeout(this.registryTimer);
      this.registryTimer = setTimeout(() => this.refreshBatches(), 250);
    }
    const batch = this.batch;
    const inputsChanged = batch && Object.values(batch.roles).some(
      (id) => previous?.states[id] !== hass.states[id],
    );
    if (inputsChanged || previous?.locale !== hass.locale
        || previous?.config.time_zone !== hass.config.time_zone) this.render();
  }

  watchConnection(connection = this._hass?.connection) {
    if (connection === this.connection) return;
    this.onConnectionReady ??= () => this.refreshBatches();
    this.connection?.removeEventListener?.("ready", this.onConnectionReady);
    this.connection = connection;
    connection?.addEventListener?.("ready", this.onConnectionReady);
  }

  get locale() {
    return this._hass?.locale?.language ?? this._hass?.language ?? "en";
  }

  get russian() { return this.locale.split("-")[0] === "ru"; }

  get t() { return this.russian ? TEXT.ru : TEXT.en; }

  get abvUnit() { return this.russian ? ABV_RU : "%"; }

  get batch() {
    return this.currentDates(this.batches.find(({ id }) => id === this.selected));
  }

  currentDates(batch) {
    if (!batch) return undefined;
    const time = (role) => Date.parse(this.state(batch, role)?.state) / 1000;
    const start = time("start");
    const end = time("end");
    return { ...batch, start: Number.isFinite(start) ? start : batch.start,
      end: Number.isFinite(end) ? end : batch.end };
  }

  state(batch, role) { return this._hass?.states[batch.roles[role]]; }

  value(batch, role) {
    const state = this.state(batch, role);
    return number(state?.state);
  }

  format(value, precision = 0, unit = "", sign = "auto") {
    if (value == null) return "—";
    const digits = new Intl.NumberFormat(this.locale, {
      minimumFractionDigits: precision, maximumFractionDigits: precision, signDisplay: sign,
    }).format(value);
    return unit ? `${digits} ${unit}` : digits;
  }

  formatDate(timestamp) {
    return new Intl.DateTimeFormat(this.locale, {
      timeZone: this._hass.config.time_zone, dateStyle: "medium",
    }).format(timestamp * 1000);
  }

  formatBadgeDate(timestamp, now) {
    const value = timestamp * 1000;
    const timeZone = this._hass.config.time_zone;
    const dateOptions = { timeZone, day: "numeric", month: "short" };
    const dateWithYear = new Intl.DateTimeFormat(this.locale, { ...dateOptions, year: "numeric" });
    const year = (parts) => parts.find(({ type }) => type === "year" || type === "relatedYear")?.value;
    const parts = dateWithYear.formatToParts(value);
    if (parts.at(-2)?.type === "year" && parts.at(-1).type === "literal") parts.pop();
    const date = year(parts) === year(dateWithYear.formatToParts(now))
      ? new Intl.DateTimeFormat(this.locale, dateOptions).format(value)
      : parts.map(({ value: part }) => part).join("");
    const time = new Intl.DateTimeFormat(this.locale, { timeZone, timeStyle: "short" }).format(value);
    return `${date} ${time}`;
  }

  async refreshBatches() {
    if (!this._hass || !this.isConnected) return;
    const connection = this._hass.connection;
    if (this.batchRequest === connection) return;
    this.batchRequest = connection;
    try {
      const coverage = await this._hass.callWS({ type: "fermentation/batches" });
      if (!this.isConnected || this._hass.connection !== connection) return;
      this.coverage = coverage;
      this.batches = coverage.batches;
      this.batchesError = false;
      if (!this.batch) this.selectBatch(defaultBatch(this.batches, Date.now())?.id, false);
      this.render();
    } catch {
      if (!this.isConnected || this._hass.connection !== connection) return;
      this.batchesError = true;
      this.render();
    } finally {
      if (this.batchRequest === connection) this.batchRequest = null;
    }
  }

  selectBatch(id, render = true) {
    if (this.selected !== id) {
      this.selected = id;
      this.chartStatus = null;
      this.chartKey = null;
      this.editError.textContent = "";
      this.dateDialog?.close();
    }
    if (render) this.render();
  }

  updateSection(target, key, render) {
    // Keep focus in date/sample controls when unrelated entity states change.
    const signature = JSON.stringify([this.selected, this.locale, key]);
    if (target.signature === signature) return;
    target.signature = signature;
    target.replaceChildren(...render());
  }

  render() {
    if (!this.isConnected || !this._hass) return;
    const { t, batch } = this;
    const now = Date.now();
    const status = batch && batchStatus(batch, now);
    this.statusLabel.textContent = status
      ? fermentationStatus(batch, status, now / 1000, t, this.locale) : "";
    this.statusLabel.hidden = !status;
    const delta = status === "active" ? this.value(batch, "delta") : null;
    this.densityChange.hidden = delta === null;
    this.densityChange.textContent = delta === null
      ? "" : `${t.delta}: ${this.format(delta, 2, "°Bx", "exceptZero")}`;
    this.picker.hidden = !this.batches.length;
    this.picker.label = t.choose;
    this.picker.hideLabel = !!batch;
    this.picker.options = this.batches.map((entry) => {
      const { id, name, start } = this.currentDates(entry);
      return { value: id, label: start == null ? name : `${name} · ${this.formatDate(start)}` };
    });
    this.picker.value = batch?.id;
    this.message.textContent = this.batchesError ? t.error
      : !this.coverage ? t.pending : this.batches.length ? "" : t.empty;
    this.message.hidden = !this.message.textContent;
    this.sections.hidden = !batch;
    if (!batch) {
      this.pendingChart = null;
      this.clearChart();
      return;
    }
    if (status !== this.chartStatus) {
      this.period = status === "finished" ? null : 3;
      if (!this.chartStatus || status === "finished") this.samples.expanded = status !== "active";
      this.chartStatus = status;
      this.chartKey = null;
    }
    this.renderSummary(batch, status);
    this.renderControls(batch, status, now);
    this.renderSamples(batch, now);
    this.renderDetails(batch);
    this.refreshGraph();
  }

  renderSummary(batch, status) {
    const { t } = this;
    const sg = (role) => this.format(this.value(batch, role), 4, "SG");
    const telemetry = status === "active"
      ? []
      : status === "finished"
        ? [["OG", sg("og")], ["FG", sg("fg")]]
        : [["OG", sg("og")]];
    const results = status === "finished"
      ? [[t.attenuation, this.format(this.value(batch, "attenuation"), 0, "%")],
        ...["final_abv", "refractometer_abv"].map((role) => [
          t[role], this.format(this.value(batch, role), 1, this.abvUnit),
        ])] : [];
    const tiles = (items) => items.map(([label, value]) => {
      const box = node("div", null, "metric");
      box.append(node("small", label), node("strong", value));
      return box;
    });
    this.summary.hidden = !telemetry.length;
    this.updateSection(this.summary, telemetry, () => tiles(telemetry));
    this.updateSection(this.results, results, () => tiles(results));
    this.results.hidden = !results.length;
  }

  renderControls(batch, status, now) {
    this.graph.hidden = status === "scheduled";
    if (this.graph.hidden) return;

    const [start, end] = historyWindow(batch, null, now);
    const fullDays = Math.max(1, Math.ceil((end - start) / 86_400_000));
    this.periodControl.label = this.t.period;
    this.periodControl.options = PERIODS.map((days) => {
      const label = durationText((days ?? fullDays) * 86400, this.locale);
      return {
        value: String(days ?? "all"),
        label,
        ariaLabel: days === null ? `${this.t.fullHistory}, ${label}` : label,
      };
    });
    this.periodControl.value = String(this.period ?? "all");
  }

  moreInfo(id) {
    this.dispatchEvent(new CustomEvent("hass-more-info", {
      detail: { entityId: id }, bubbles: true, composed: true,
    }));
  }

  renderSamples(batch, now) {
    const { t } = this;
    this.samples.header = t.samples;
    const dates = [
      [t.start, batch.start, t.setStart, batch.roles.start, false],
      [t.finish, batch.end, t.setFinish, batch.roles.end, batch.start == null],
    ].map(([title, value, prompt, id, disabled]) => ({
      title, value, prompt, id, disabled,
      label: value == null ? prompt : this.formatBadgeDate(value, now),
    }));
    this.updateSection(this.dates, dates, () => dates.map(
      ({ title, value, prompt, id, disabled, label }) => {
        const action = id && !disabled
          ? () => value == null ? this.setInitialDate(id, prompt) : this.moreInfo(id)
          : null;
        const badge = actionBadge(label, action);
        badge.label = title;
        return badge;
      },
    ));
    const probes = PROBES.map((key) => ["initial", "final"].map((stage) => {
      const role = `${stage}_${key}`;
      return [batch.roles[role], this.value(batch, role), key === "ph" ? 2 : 1,
        !!this.state(batch, role)?.attributes.outside_correction_table];
    }));
    this.updateSection(this.sampleValues, probes, () => {
      const table = node("table", null, "samples-table");
      table.setAttribute("role", "table");
      const head = table.createTHead();
      head.setAttribute("role", "rowgroup");
      const header = head.insertRow();
      header.setAttribute("role", "row");
      for (const label of ["", t.start, t.finish]) {
        const cell = node("th", label);
        cell.scope = "col";
        cell.setAttribute("role", "columnheader");
        header.append(cell);
      }
      const body = table.createTBody();
      body.setAttribute("role", "rowgroup");
      probes.forEach((values, index) => {
        const row = body.insertRow();
        row.setAttribute("role", "row");
        const title = t[PROBES[index]];
        const heading = node("th", title);
        heading.scope = "row";
        heading.setAttribute("role", "rowheader");
        row.append(heading);
        values.forEach(([id, value, precision, warning], column) => {
          const cell = row.insertCell();
          cell.setAttribute("role", "cell");
          const actions = node("div", null, "sample-actions");
          const reading = this.format(value, precision);
          const stage = column === 0 ? t.start : t.finish;
          const edit = actionBadge(reading, id ? () => this.moreInfo(id) : null);
          if (id) edit.prepend(node("span", `${stage} · ${title} · `, "visually-hidden"));
          actions.append(edit);
          if (id && value !== null) {
            const clear = node("ha-button", "×");
            clear.size = "s";
            clear.appearance = "plain";
            clear.variant = "neutral";
            clear.addEventListener("click", () => this.clearSample(id, clear));
            clear.title = t.clear;
            clear.setAttribute("aria-label", `${t.clear} · ${stage} · ${title}`);
            actions.append(clear);
          }
          cell.append(actions);
          if (warning) cell.append(node("small", t.outsideTable));
        });
      });
      return [table];
    });
  }

  setInitialDate(id, title) {
    // Home Assistant 2026.11 more-info cannot save a datetime whose state is unknown.
    const dialog = this.dateDialog = node("dialog");
    const form = node("form");
    const heading = node("h2", title);
    heading.id = "fermentation-date-heading";
    dialog.setAttribute("aria-labelledby", heading.id);
    const label = node("label", Intl.DateTimeFormat().resolvedOptions().timeZone);
    const input = node("input");
    input.type = "datetime-local";
    input.required = true;
    const now = new Date();
    input.value = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    label.append(input);
    const error = node("div");
    error.setAttribute("role", "alert");
    const actions = node("div", null, "dialog-actions");
    const cancel = button(this.t.cancel, () => dialog.close());
    const save = node("button", this.t.save);
    save.type = "submit";
    actions.append(cancel, save);
    form.append(heading, label, error, actions);
    dialog.append(form);
    this.shadowRoot.append(dialog);
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (this.dateDialog === dialog) this.dateDialog = null;
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      save.disabled = true;
      error.textContent = "";
      try {
        const datetime = new Date(input.value).toISOString();
        await this._hass.callService("datetime", "set_value", { datetime }, { entity_id: id });
        dialog.close();
      } catch (failure) {
        error.textContent = failure?.message || this.t.dateError;
      } finally {
        save.disabled = false;
      }
    });
    dialog.showModal();
  }

  async clearSample(id, control) {
    if (!window.confirm(this.t.confirmClear)) return;
    control.disabled = true;
    this.editError.textContent = "";
    const selected = this.selected;
    try {
      await this._hass.callService("fermentation", "clear_sample", {}, { entity_id: id });
    } catch {
      if (selected === this.selected) this.editError.textContent = this.t.clearError;
    } finally {
      control.disabled = false;
    }
  }

  renderDetails(batch) {
    const { t } = this;
    const source = this.state(batch, "og")?.attributes.og_source;
    const diagnostics = [
      [t.ogSource, { hydrometer: t.hydrometerSource, refractometer: t.refractometerSource }[source] ?? "—"],
      [t.workingWcf, this.format(batch.wcf, 3)],
      [t.sampleWcf, this.format(this.value(batch, "sample_wcf"), 3)],
    ];
    this.updateSection(this.diagnostic, diagnostics, () => [
      diagnostics.map(([label, value]) => `${label}: ${value}`).join(". ") + ".",
    ]);
    this.updateSection(this.links, [batch.device, batch.pill], () => [
      [batch.device, t.device], [batch.pill, t.pill],
    ].filter(([id]) => id).flatMap(([id, label], index) => {
      const link = node("a", label);
      link.href = `/config/devices/device/${encodeURIComponent(id)}`;
      return index ? [" · ", link] : [link];
    }));
  }

  resizeChart = () => {
    const height = chartHeight();
    if (this.apexChart && this.chartHeight !== height) {
      this.chartHeight = height;
      this.apexChart.updateOptions({ chart: { height } }, false, false);
    }
  };

  mountChart(series, start, end) {
    this.chartHeight = chartHeight();
    const apex = document.createElement("apexcharts-card");
    apex.setConfig(chartConfig(series, start, end, this.t, this.locale,
      this._hass.config.time_zone, this.period, this.chartStatus === "active"));
    const states = { ...this._hass.states };
    for (const { entity, points } of series) {
      states[entity] = { ...states[entity],
        attributes: { ...states[entity]?.attributes, fermentation_points: points } };
    }
    apex.hass = { ...this._hass, states, locale: { ...this._hass.locale, time_zone: "local" } };
    apex.addEventListener("fermentation-chart-ready", ({ detail }) => {
      if (this.chart.firstChild !== apex) return;
      this.apexChart = detail;
      this.resizeChart();
    }, { once: true });
    this.chart.replaceChildren(apex);
    // The embedded chart uses the Fermentation card as its surface.
    const style = node("style");
    style.textContent = `
      ha-card {
        background: transparent !important;
        border: 0 !important;
        box-shadow: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }
      ha-card::before, ha-card::after { content: none !important; }
    `;
    apex.shadowRoot?.append(style);
  }

  clearChart() {
    this.apexChart?.destroy();
    this.apexChart = null;
    this.chartSeries = null;
    this.chart.replaceChildren();
  }

  async refreshGraph(force = false) {
    const batch = this.batch;
    if (!this.isConnected || !batch || this.chartStatus === "scheduled") {
      this.pendingChart = null;
      this.chartKey = null;
      this.historySnapshot = null;
      this.clearChart();
      return;
    }
    const [start, end] = historyWindow(batch, this.period, Date.now());
    const series = SERIES.filter(({ role }) => batch.roles[role])
      .map((item) => ({ ...item, entity: batch.roles[item.role] }));
    const key = JSON.stringify([batch.id, batch.start, batch.end, this.chartStatus, this.period,
      series, this.locale, this._hass.config.time_zone,
      this.coverage?.recorder, start < this.coverage?.oldest * 1000]);
    if (this.pendingChart?.key === key || (key === this.chartKey && !force)) return;
    if (key !== this.chartKey) {
      this.historySnapshot = null;
      this.clearChart();
      this.historyMessage.textContent = this.t.loading;
    }
    this.chartKey = key;
    if (!customElements.get("apexcharts-card")) {
      this.historyMessage.textContent = this.t.apex;
      return;
    }
    const request = { key };
    this.pendingChart = request;
    try {
      const result = await loadHistory(this._hass, series, start, end, this.coverage, this.historySnapshot);
      if (this.pendingChart !== request) return;
      this.historySnapshot = result.snapshot;
      if (!result.series.length) {
        this.clearChart();
        this.historyMessage.textContent = this.t.noHistory;
        return;
      }
      const chartSeries = result.series.map(({ entity }) => entity).join(",");
      if (this.apexChart && this.chartSeries === chartSeries) {
        await this.apexChart.updateOptions({
          xaxis: { min: start, max: end },
          // ApexCharts replaces the axis array, so keep the existing formatters and styles.
          yaxis: this.apexChart.w.config.yaxis.map((axis, index) => ({
            ...axis, ...minimumAxisBounds(result.series[index]),
          })),
          series: result.series.map(({ role, points }) => ({ name: chartSeriesName(this.t, role), data: points })),
        }, false, false);
      } else {
        this.mountChart(result.series, start, end);
        this.chartSeries = chartSeries;
      }
      if (this.pendingChart === request) this.historyMessage.textContent = "";
    } catch {
      if (this.pendingChart !== request) return;
      this.chartKey = null;
      this.historyMessage.textContent = this.t.historyError;
    } finally {
      if (this.pendingChart === request) this.pendingChart = null;
    }
  }
}

if (!customElements.get("fermentation-card")) {
  customElements.define("fermentation-card", FermentationCard);
  window.customCards ??= [];
  window.customCards.push({
    type: "fermentation-card",
    name: "Fermentation",
    description: "Show fermentation history and manage batch samples.",
    documentationURL: "https://github.com/Edheltur/ha-fermentation#дашборд",
  });
}
