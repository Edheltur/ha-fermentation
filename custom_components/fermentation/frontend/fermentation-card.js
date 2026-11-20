import { batchStatus, celsius, defaultBatch, historyWindow, loadHistory, number, SERIES } from "./history.js";

const TEXT = {
  ru: {
    active: "Активна", scheduled: "Запланирована", finished: "Завершена",
    title: "Ферментация", choose: "Выберите ферментацию", empty: "Нет доступных ферментаций",
    duration: "Длительность", delta: "∆ за 24 ч", abv: "Алкоголь по Pill",
    brix: "Плотность", temperature: "Температура сусла", insufficient: "Недостаточно истории",
    all: "Вся", showAbv: "Показать алкоголь", loading: "Загрузка истории…",
    noHistory: "Нет записанной истории", hourly: "Средние за час",
    apex: "Установите и загрузите ресурс apexcharts-card для просмотра графика.",
    error: "Не удалось загрузить данные", historyError: "Не удалось загрузить историю",
    start: "Старт", finish: "Финиш", setStart: "Указать старт", setFinish: "Указать финиш",
    samples: "Ручные пробы", hydrometer: "АС-3, °Bx", sample_temperature: "Температура пробы, °C",
    refractometer: "Рефрактометр, °Bx", ph: "pH", clear: "Очистить значение",
    confirmClear: "Очистить это значение пробы?", clearError: "Не удалось очистить значение пробы",
    outsideTable: "Вне таблицы поправок АС-3", attenuation: "Видимая степень сбраживания",
    final_abv: "Алкоголь по АС-3", refractometer_abv: "Алкоголь по рефрактометру",
    details: "Подробности", ogSource: "Источник OG", workingWcf: "Рабочий WCF",
    sampleWcf: "WCF по начальной пробе", hydrometerSource: "АС-3",
    refractometerSource: "Рефрактометр", device: "Устройство ферментации", pill: "Устройство Pill",
    pending: "Загрузка ферментаций…", save: "Сохранить", cancel: "Отмена",
    dateError: "Не удалось сохранить дату",
  },
  en: {
    active: "Active", scheduled: "Scheduled", finished: "Finished",
    title: "Fermentation", choose: "Select a fermentation", empty: "No available fermentations",
    duration: "Duration", delta: "24 h change", abv: "Pill ABV",
    brix: "Gravity", temperature: "Wort temperature", insufficient: "Insufficient history",
    all: "All", showAbv: "Show ABV", loading: "Loading history…",
    noHistory: "No recorded history", hourly: "Hourly averages",
    apex: "Install and load the apexcharts-card resource to view the chart.",
    error: "Could not load data", historyError: "Could not load history",
    start: "Start", finish: "Finish", setStart: "Set start", setFinish: "Set finish",
    samples: "Manual samples", hydrometer: "AS-3, °Bx", sample_temperature: "Sample temperature, °C",
    refractometer: "Refractometer, °Bx", ph: "pH", clear: "Clear value",
    confirmClear: "Clear this sample value?", clearError: "Could not clear the sample value",
    outsideTable: "Outside the AS-3 correction table", attenuation: "Apparent attenuation",
    final_abv: "AS-3 ABV", refractometer_abv: "Refractometer ABV",
    details: "Details", ogSource: "OG source", workingWcf: "Working WCF",
    sampleWcf: "WCF from initial sample", hydrometerSource: "AS-3",
    refractometerSource: "Refractometer", device: "Fermentation device", pill: "Pill device",
    pending: "Loading fermentations…", save: "Save", cancel: "Cancel",
    dateError: "Could not save the date",
  },
};

const PROBES = ["hydrometer", "sample_temperature", "refractometer", "ph"];
const PERIODS = [1, 3, 10, null];
const REFRESH = 60_000;
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

function durationText(seconds, russian) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds / 3600) % 24;
  const dayWord = russian
    ? new Intl.PluralRules("ru").select(days)
    : days === 1 ? "one" : "other";
  const labels = russian ? { one: "день", few: "дня", many: "дней" } : { one: "day", other: "days" };
  const parts = [];
  if (days) parts.push(`${days} ${labels[dayWord]}`);
  if (hours || !days) parts.push(russian ? `${hours}ч` : `${hours} h`);
  return parts.join(" ");
}

function chartConfig(series, start, end, t, locale, timeZone) {
  // Anchor span.offset to a calendar boundary so a finished chart does not drift.
  const base = new Date(new Date().getFullYear(), 0, 1).getTime();
  const offset = start - base;
  const dateFormatter = `EVAL:function(value) {
    return new Intl.DateTimeFormat(${JSON.stringify(locale)}, {
      timeZone: ${JSON.stringify(timeZone)}, month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(Number(value));
  }`;
  return {
    type: "custom:apexcharts-card",
    graph_span: `${end - start}ms`,
    span: { start: "year", offset: `${offset >= 0 ? "+" : ""}${offset}ms` },
    header: { show: false },
    series: series.map(({ role, entity, color, precision }) => ({
      entity, name: t[role], color, float_precision: precision,
      stroke_width: 2, stroke_dash: role === "abv" ? 5 : 0, curve: "straight",
      extend_to: false, data_generator: "return entity.attributes.fermentation_points;",
    })),
    apex_config: {
      chart: {
        height: 260, toolbar: { show: false }, zoom: { enabled: false }, animations: { enabled: false },
        events: {
          updated: `EVAL:function(chart) {
            chart.el.dispatchEvent(new CustomEvent("fermentation-chart-ready", {
              detail: chart, bubbles: true, composed: true
            }));
          }`,
        },
      },
      yaxis: series.map(({ role, color, unit, precision }) => ({
        seriesName: t[role], opposite: role !== "brix", decimalsInFloat: precision, tickAmount: 4,
        title: { text: unit, style: { color } },
        labels: { style: { colors: color } },
      })),
      legend: { show: false },
      xaxis: { labels: { formatter: `EVAL:function(_value, timestamp) {
        const format = ${dateFormatter.slice(5)};
        return format(timestamp);
      }` } },
      tooltip: {
        shared: true, intersect: false, hideEmptySeries: false,
        x: { formatter: dateFormatter },
        y: series.map(({ unit, precision }) => ({
          formatter: `EVAL:function(value) {
            return Number.isFinite(value)
              ? new Intl.NumberFormat(${JSON.stringify(locale)}, { minimumFractionDigits: ${precision},
                  maximumFractionDigits: ${precision} }).format(value) + ${JSON.stringify(` ${unit}`)}
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
    this.showAbv = false;
    const style = node("style");
    style.textContent = `
      :host { display: block; min-width: 0; }
      ha-card { display: block; padding: 16px; overflow: hidden; }
      h2 { margin: 0; font-size: 1.25rem; overflow-wrap: anywhere; }
      p { margin: 8px 0; }
      select, button { font: inherit; color: inherit; border: 1px solid var(--divider-color);
        border-radius: 8px; background: var(--card-background-color); }
      button { padding: 5px 7px; min-height: 36px; cursor: pointer; }
      button[aria-pressed="true"] { color: var(--primary-color); border-color: currentColor; }
      button:disabled { opacity: .5; cursor: default; }
      select { min-height: 40px; width: 100%; padding: 4px 8px; margin-top: 8px; }
      .muted, small { color: var(--secondary-text-color); }
      .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 78px), 1fr));
        gap: 6px; margin: 14px 0; }
      .metric { display: grid; gap: 4px; align-content: start; padding: 8px 6px; text-align: center;
        background: var(--secondary-background-color); border-radius: 8px; overflow-wrap: anywhere; }
      .metric strong { font-size: 1.05rem; }
      .controls { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
      .controls label { display: inline-flex; align-items: center; gap: 3px; min-height: 36px; }
      .legend { display: flex; flex-wrap: wrap; gap: 5px 12px; margin: 8px 0 4px; font-size: .875rem; }
      .legend span::before { content: ""; width: .6rem; height: .6rem; border-radius: 50%;
        display: inline-block; margin-inline-end: .35rem; background: var(--series-color); }
      .chart { min-width: 0; }
      .chart > apexcharts-card { --ha-card-border-width: 0; --ha-card-box-shadow: none; }
      .dates { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin: 12px 0; }
      .dates div { display: grid; gap: 4px; }
      details { margin-top: 10px; }
      summary { padding: 8px 0; cursor: pointer; font-weight: 600; }
      table { border-collapse: collapse; width: 100%; table-layout: fixed; }
      th, td { padding: 4px 2px; text-align: start; overflow-wrap: anywhere; vertical-align: top; }
      th:first-child { width: 34%; }
      td > div { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
      .clear { min-width: 32px; color: var(--secondary-text-color); }
      .links { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-top: 12px; }
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
    this.heading = node("h2");
    this.statusLabel = node("div", null, "muted");
    this.picker = node("select");
    this.picker.addEventListener("change", () => this.selectBatch(this.picker.value));
    this.message = node("p", null, "muted");
    this.summary = node("section", null, "metrics");
    this.graph = node("section");
    this.controls = node("div", null, "controls");
    this.legend = node("div", null, "legend");
    this.historyMessage = node("p", null, "muted");
    this.historyMessage.setAttribute("role", "status");
    this.chart = node("div", null, "chart");
    this.graph.append(this.controls, this.legend, this.historyMessage, this.chart);
    this.results = node("section", null, "metrics");
    this.dates = node("section", null, "dates");
    this.samples = node("details");
    this.samplesHeading = node("summary");
    this.sampleValues = node("div");
    this.samples.append(this.samplesHeading, this.sampleValues);
    this.details = node("details");
    this.detailsHeading = node("summary");
    this.diagnostic = node("div");
    this.details.append(this.detailsHeading, this.diagnostic);
    this.editError = node("p");
    this.editError.setAttribute("role", "alert");
    this.links = node("div", null, "links");
    this.sections = node("div");
    this.sections.append(this.summary, this.graph, this.results, this.dates, this.samples,
      this.editError, this.details, this.links);
    card.append(this.heading, this.statusLabel, this.picker, this.message, this.sections);
    this.shadowRoot.append(style, card);
  }

  setConfig(_config) {}

  getCardSize() { return 7; }

  connectedCallback() {
    this.watchConnection();
    this.refreshBatches();
    this.timer = setInterval(async () => {
      await this.refreshBatches();
      if (!this.batchesError && this.chartStatus === "active") this.refreshGraph(true);
    }, REFRESH);
    customElements.whenDefined("apexcharts-card").then(() => this.refreshGraph(true));
  }

  disconnectedCallback() {
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

  formatDate(timestamp, time = false) {
    return new Intl.DateTimeFormat(this.locale, {
      timeZone: this._hass.config.time_zone,
      dateStyle: "medium", ...(time ? { timeStyle: "short" } : {}),
    }).format(timestamp * 1000);
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
      this.details.open = false;
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
    const status = batch && batchStatus(batch, Date.now());
    this.heading.textContent = batch?.name ?? t.title;
    this.statusLabel.textContent = status ? t[status] : "";
    this.picker.hidden = !this.batches.length;
    this.picker.setAttribute("aria-label", t.choose);
    const choices = this.batches.map((entry) => this.currentDates(entry));
    this.updateSection(this.picker, [choices.map(({ id, name, start }) => [id, name, start]),
      this._hass.config.time_zone], () => {
      const prompt = node("option", t.choose);
      prompt.value = "";
      prompt.disabled = true;
      return [prompt, ...choices.map(({ id, name, start }) => {
        const option = node("option", start == null ? name : `${name} · ${this.formatDate(start)}`);
        option.value = id;
        return option;
      })];
    });
    this.picker.value = this.selected ?? "";
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
      if (!this.chartStatus || status === "finished") this.samples.open = status !== "active";
      this.chartStatus = status;
      this.chartKey = null;
    }
    this.renderSummary(batch, status);
    this.renderControls(batch, status);
    this.renderSamples(batch);
    this.renderDetails(batch);
    this.refreshGraph();
  }

  renderSummary(batch, status) {
    const { t } = this;
    const sg = (role) => this.format(this.value(batch, role), 4, "SG");
    const durationState = this.state(batch, "duration");
    const units = { d: 86400, h: 3600, min: 60, s: 1, ms: 0.001 };
    const duration = number(durationState?.state);
    const factor = units[durationState?.attributes.unit_of_measurement];
    const elapsed = duration === null || factor === undefined
      ? "—" : durationText(Math.round(duration * factor), this.russian);
    const delta = this.value(batch, "delta");
    const telemetry = status === "active"
      ? [[t.duration, elapsed],
        [t.delta, this.format(delta, 2, "°Bx", "exceptZero"),
          delta === null && number(this.state(batch, "brix")?.state) !== null ? t.insufficient : ""],
        [t.abv, this.format(this.value(batch, "abv"), 1, this.abvUnit)]]
      : status === "finished"
        ? [[t.duration, elapsed], ["OG", sg("og")], ["FG", sg("fg")]]
        : [["OG", sg("og")]];
    const results = status === "finished"
      ? [[t.attenuation, this.format(this.value(batch, "attenuation"), 0, "%")],
        ...["final_abv", "refractometer_abv"].map((role) => [
          t[role], this.format(this.value(batch, role), 1, this.abvUnit),
        ])] : [];
    const tiles = (items) => items.map(([label, value, help]) => {
      const box = node("div", null, "metric");
      box.append(node("small", label), node("strong", value));
      if (help) box.append(node("small", help));
      return box;
    });
    this.updateSection(this.summary, telemetry, () => tiles(telemetry));
    this.updateSection(this.results, results, () => tiles(results));
    this.results.hidden = !results.length;
  }

  renderControls(batch, status) {
    const { t } = this;
    this.graph.hidden = status === "scheduled";
    this.updateSection(this.controls, [this.period, this.showAbv, batch.roles.abv], () => {
      const periods = PERIODS.map((days) => {
        const el = button(days == null ? t.all : durationText(days * 86400, this.russian), () => {
          this.period = days;
          this.render();
        });
        el.setAttribute("aria-pressed", String(days === this.period));
        return el;
      });
      if (batch.roles.abv) {
        const label = node("label");
        const toggle = node("input");
        toggle.type = "checkbox";
        toggle.checked = this.showAbv;
        toggle.addEventListener("change", () => {
          this.showAbv = toggle.checked;
          this.render();
          this.controls.querySelector("input")?.focus();
        });
        label.append(toggle, t.showAbv);
        periods.push(label);
      }
      return periods;
    });

    const legend = SERIES.filter(({ role }) => (role !== "abv" || this.showAbv) && batch.roles[role])
      .map(({ role, unit, color, precision }) => {
        const state = this.state(batch, role);
        const value = number(state?.state);
        return [t[role], unit, color, status === "active"
          ? this.format(role === "temperature" ? celsius(value, state?.attributes.unit_of_measurement) : value,
            precision, unit) : unit];
      });
    this.updateSection(this.legend, legend, () => legend.map(([name, unit, color, value]) => {
      const el = node("span", `${name} · ${value === "—" ? `— ${unit}` : value}`);
      el.style.setProperty("--series-color", color);
      return el;
    }));
  }

  moreInfo(id) {
    this.dispatchEvent(new CustomEvent("hass-more-info", {
      detail: { entityId: id }, bubbles: true, composed: true,
    }));
  }

  renderSamples(batch) {
    const { t } = this;
    this.samplesHeading.textContent = t.samples;
    const dates = [
      [t.start, batch.start, t.setStart, batch.roles.start, false],
      [t.finish, batch.end, t.setFinish, batch.roles.end, batch.start == null],
    ];
    this.updateSection(this.dates, [dates, this._hass.config.time_zone], () => dates.map(
      ([title, value, prompt, id, disabled]) => {
        const cell = node("div");
        cell.append(node("small", title), button(
          value == null ? prompt : this.formatDate(value, true),
          () => value == null ? this.setInitialDate(id, prompt) : this.moreInfo(id), !id || disabled,
        ));
        return cell;
      },
    ));
    const probes = PROBES.map((key) => ["initial", "final"].map((stage) => {
      const role = `${stage}_${key}`;
      return [batch.roles[role], this.value(batch, role), key === "ph" ? 2 : 1,
        !!this.state(batch, role)?.attributes.outside_correction_table];
    }));
    this.updateSection(this.sampleValues, probes, () => {
      const table = node("table");
      const header = table.createTHead().insertRow();
      for (const label of ["", t.start, t.finish]) {
        const cell = node("th", label);
        cell.scope = "col";
        header.append(cell);
      }
      const body = table.createTBody();
      probes.forEach((values, index) => {
        const row = body.insertRow();
        const title = t[PROBES[index]];
        const heading = node("th", title);
        heading.scope = "row";
        row.append(heading);
        values.forEach(([id, value, precision, warning], column) => {
          const cell = row.insertCell();
          const actions = node("div");
          const reading = this.format(value, precision);
          const stage = column === 0 ? t.start : t.finish;
          const edit = button(reading, () => this.moreInfo(id), !id);
          edit.setAttribute("aria-label", `${stage} · ${title} · ${reading}`);
          actions.append(edit);
          if (id && value !== null) {
            const clear = button("×", () => this.clearSample(id, clear));
            clear.className = "clear";
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
    this.detailsHeading.textContent = t.details;
    const source = this.state(batch, "og")?.attributes.og_source;
    const diagnostics = [
      [t.ogSource, { hydrometer: t.hydrometerSource, refractometer: t.refractometerSource }[source] ?? "—"],
      [t.workingWcf, this.format(batch.wcf, 3)],
      [t.sampleWcf, this.format(this.value(batch, "sample_wcf"), 3)],
    ];
    this.updateSection(this.diagnostic, diagnostics, () => diagnostics.map(
      ([label, value]) => node("p", `${label} · ${value}`),
    ));
    this.updateSection(this.links, [batch.device, batch.pill], () => [
      [batch.device, t.device], [batch.pill, t.pill],
    ].filter(([id]) => id).map(([id, label]) => {
      const link = node("a", label);
      link.href = `/config/devices/device/${encodeURIComponent(id)}`;
      return link;
    }));
  }

  mountChart(series, start, end) {
    const apex = document.createElement("apexcharts-card");
    apex.setConfig(chartConfig(series, start, end, this.t, this.locale, this._hass.config.time_zone));
    const states = { ...this._hass.states };
    for (const { entity, points } of series) {
      states[entity] = { ...states[entity],
        attributes: { ...states[entity]?.attributes, fermentation_points: points } };
    }
    apex.hass = { ...this._hass, states, locale: { ...this._hass.locale, time_zone: "local" } };
    apex.addEventListener("fermentation-chart-ready", ({ detail }) => {
      if (this.chart.firstChild === apex) this.apexChart = detail;
    }, { once: true });
    this.chart.replaceChildren(apex);
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
    const series = SERIES.filter(({ role }) => batch.roles[role] && (role !== "abv" || this.showAbv))
      .map((item) => ({ ...item, entity: batch.roles[item.role] }));
    const key = JSON.stringify([batch.id, batch.start, batch.end, this.chartStatus, this.period,
      this.showAbv, series, this.locale, this._hass.config.time_zone,
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
          series: result.series.map(({ role, points }) => ({ name: this.t[role], data: points })),
        }, false, false);
      } else {
        this.mountChart(result.series, start, end);
        this.chartSeries = chartSeries;
      }
      if (this.pendingChart === request) this.historyMessage.textContent = result.hourly ? this.t.hourly : "";
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
}
