"""Build a plain-text report from the saved input of one fermentation."""

from datetime import datetime
from zoneinfo import ZoneInfo

from .calculation import hydrometer_at_20


def duration_text(seconds, russian):
    days, hours = divmod(int(seconds) // 3600, 24)
    if russian:
        day_word = "дней"
        if not 11 <= days % 100 <= 14:
            if days % 10 == 1:
                day_word = "день"
            elif 2 <= days % 10 <= 4:
                day_word = "дня"
        parts = [f"{days} {day_word}" if days else "", f"{hours} ч" if hours or not days else ""]
    else:
        parts = [
            f"{days} {'day' if days == 1 else 'days'}" if days else "",
            f"{hours} h" if hours or not days else "",
        ]
    return " ".join(filter(None, parts))


_RU_MONTHS = (
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
)
_EN_MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)


class Report:
    def __init__(self, title, data, now, timezone, language, results):
        self.values = results
        self.title = title
        self.data = data
        self.now = now
        self.timezone = ZoneInfo(timezone)
        self.russian = language.split("-")[0] == "ru"

    def label(self, russian, english):
        return russian if self.russian else english

    def decimal(self, value, precision):
        text = f"{value:.{precision}f}"
        return text.replace(".", ",") if self.russian else text

    def date(self, date):
        month = (_RU_MONTHS if self.russian else _EN_MONTHS)[date.month - 1]
        return f"{date.day} {month} {date.year}"

    def period(self):
        start, end = self.data.get("start"), self.data.get("end")
        if start is None or start > self.now:
            status = self.label("Ферментация запланирована", "Fermentation scheduled")
            if start is not None:
                status += f" · {self.date(datetime.fromtimestamp(start, self.timezone))}"
            return status
        start_date = datetime.fromtimestamp(start, self.timezone)
        if end is None or end > self.now:
            since = self.label("Ферментация идёт · с", "Fermentation ongoing · since")
            return (
                f"{since} {self.date(start_date)} · {duration_text(self.now - start, self.russian)}"
            )
        end_date = datetime.fromtimestamp(end, self.timezone)
        if start_date.date() == end_date.date():
            dates = self.date(start_date)
        elif (start_date.year, start_date.month) == (end_date.year, end_date.month):
            dates = f"{start_date.day}–{self.date(end_date)}"
        else:
            dates = f"{self.date(start_date)} – {self.date(end_date)}"
        duration = duration_text(end - start, self.russian)
        return f"{self.label('Ферментация', 'Fermentation')} · {dates} · {duration}"

    def sample(self, stage):
        hydrometer, temperature, optical, ph = (
            self.data.get(f"{stage}_{key}")
            for key in ("hydrometer", "sample_temperature", "refractometer", "ph")
        )
        lines = []
        if hydrometer is not None:
            line = f"{self.label('АС-3', 'AS-3')}: {self.decimal(hydrometer, 1)} °Bx"
            if temperature is not None:
                line += f" {self.label('при', 'at')} {self.decimal(temperature, 1)} °C"
                corrected = hydrometer_at_20(hydrometer, temperature)
                if corrected is None:
                    warning = self.label(
                        "Вне таблицы поправок АС-3", "Outside the AS-3 correction table"
                    )
                    line += f" · {warning}"
                elif temperature != 20:
                    line += f" → {self.decimal(corrected, 2)} °Bx {self.label('при', 'at')} 20 °C"
            lines.append(line)
        elif temperature is not None:
            name = self.label("Температура пробы", "Sample temperature")
            lines.append(f"{name}: {self.decimal(temperature, 1)} °C")
        if optical is not None:
            lines.append(
                f"{self.label('Рефрактометр', 'Refractometer')}: {self.decimal(optical, 1)} °Bx"
            )
        if ph is not None:
            lines.append(f"pH: {self.decimal(ph, 2)}")
        return lines

    def results(self):
        results = self.values
        lines = []
        hydrometer = self.label("АС-3", "AS-3")
        for key in ("og", "fg"):
            if (value := results[key]) is None:
                continue
            source = hydrometer
            if results[f"{key}_source"] == "pill":
                source = "RAPT Pill"
            elif results[f"{key}_source"] == "refractometer":
                source = self.label("рефрактометр", "refractometer")
                source += f", WCF {self.decimal(self.data['wcf'], 3)}"
            lines.append(f"{key.upper()}: {self.decimal(value, 4)} SG ({source})")
        for key, label, precision, unit in (
            (
                "final_abv",
                self.label("Итоговый алкоголь", "Final ABV"),
                1,
                self.label("% об.", "%"),
            ),
            (
                "refractometer_abv",
                self.label("Алкоголь по рефрактометру", "Refractometer ABV"),
                1,
                self.label("% об.", "%"),
            ),
            (
                "attenuation",
                self.label("Видимая степень сбраживания", "Apparent attenuation"),
                0,
                "%",
            ),
        ):
            if (value := results[key]) is not None:
                lines.append(f"{label}: {self.decimal(value, precision)} {unit}")
        wcf = []
        if any(
            self.data.get(f"{stage}_refractometer") is not None for stage in ("initial", "final")
        ):
            if (value := self.data.get("wcf")) is not None and results["applied_wcf"] is None:
                wcf.append(f"{self.label('рабочий', 'working')} {self.decimal(value, 3)}")
            if (value := results["sample_wcf"]) is not None:
                label = self.label("по начальной пробе", "from initial sample")
                wcf.append(f"{label} {self.decimal(value, 3)}")
        if wcf:
            lines.append("WCF: " + " · ".join(wcf))
        return lines

    def render(self):
        sections = [f"{self.title}\n{self.period()}"]
        if (description := self.data.get("description")) and description.strip():
            sections.append(description)
        for stage, heading in (
            ("initial", self.label("Начальная проба", "Initial sample")),
            ("final", self.label("Конечная проба", "Final sample")),
        ):
            if lines := self.sample(stage):
                sections.append("\n".join([heading, *lines]))
            elif stage == "final" and (end := self.data.get("end")) is not None and end <= self.now:
                sections.append(self.label("Конечная проба не внесена", "Final sample not entered"))
        if lines := self.results():
            sections.append("\n".join([self.label("Итоги", "Results"), *lines]))
        return "\n\n".join(sections)
