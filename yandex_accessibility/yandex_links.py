"""Ссылки на маршруты Яндекс Карт с заданным временем отправления и приём замеров.

Яндекс отдаёт прогноз по типичной загруженности на выбранный день, а не фактический трафик.
Замеры считываются вручную или из браузера: для каждой ссылки берётся первый (самый быстрый)
маршрут на авто — время в минутах и длина в км. Проверяйте, что Яндекс принял время
отправления (в карточке маршрута оно должно совпасть с заданным)."""
import html
import re
from urllib.parse import quote

import pandas as pd

from .config import SLOTS, City


def route_url(lat, lon, city: City, date: str, slot: str) -> str:
    """Маршрут из точки в центр, на авто, с временем отправления."""
    t = quote(f"{date}T{slot}:00", safe="")
    return (
        "https://yandex.com/maps/?mode=routes&rtt=auto"
        f"&rtext={lat:.6f},{lon:.6f}~{city.lat:.6f},{city.lon:.6f}"
        f"&routes%5BtimeDependent%5D%5Btime%5D={t}"
    )


def links_table(points: pd.DataFrame, city: City, date: str, slots=SLOTS) -> pd.DataFrame:
    rows = [
        {"point_id": p.point_id, "label": p.label, "slot": s, "url": route_url(p.lat, p.lon, city, date, s)}
        for p in points.itertuples() for s in slots
    ]
    return pd.DataFrame(rows)


def write_html(points: pd.DataFrame, city: City, date: str, path, slots=SLOTS) -> None:
    """Страница со ссылками и полями ввода «минуты|км» (например `27|23.6`) + выгрузка CSV."""
    head = "".join(f"<th>{s}</th>" for s in slots)
    body = []
    for p in points.itertuples():
        cells = "".join(
            f'<td><a href="{html.escape(route_url(p.lat, p.lon, city, date, s))}" target="_blank">открыть</a> '
            f'<input size="9" data-id="{p.point_id}" data-slot="{s}" placeholder="мин|км"></td>'
            for s in slots
        )
        body.append(f"<tr><td>{p.point_id}</td><td>{p.label}</td><td>{p.straight_km:.1f}</td>{cells}</tr>")
    page = f"""<!doctype html><meta charset="utf-8"><title>Замеры Яндекс Карт — {city.name}</title>
<style>body{{font:14px sans-serif;margin:16px}}td,th{{padding:3px 8px;border-bottom:1px solid #ddd}}</style>
<h1>{city.name}: замеры на {date}</h1>
<p>Для каждой ссылки возьмите первый маршрут на авто и впишите «минуты|км». Время отправления должно совпасть с заголовком столбца.</p>
<table><tr><th>№</th><th>точка</th><th>по прямой, км</th>{head}</tr>{''.join(body)}</table>
<p><button onclick="dl()">Скачать CSV</button></p>
<script>
function dl(){{
  let out=['point_id,slot,minutes,km'];
  document.querySelectorAll('input').forEach(i=>{{
    const v=i.value.trim().replace(',','.'); if(!v) return;
    const [m,k]=v.split('|'); out.push([i.dataset.id,i.dataset.slot,m,k||''].join(','));
  }});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([out.join('\\n')],{{type:'text/csv'}}));
  a.download='travel_times.csv'; a.click();
}}
</script>"""
    with open(path, "w", encoding="utf-8") as f:
        f.write(page)


_DURATION = re.compile(r"(?:(\d+)\s*(?:ч|h))?\s*(?:(\d+)\s*(?:мин|min))?", re.I)


def parse_minutes(text) -> float:
    """'27', '27.5', '1 ч 5 мин', '1h 5 min' → минуты."""
    s = str(text).strip().replace(",", ".")
    try:
        return float(s)
    except ValueError:
        h, m = _DURATION.fullmatch(s).groups() if _DURATION.fullmatch(s) else (None, None)
        if h is None and m is None:
            raise ValueError(f"не разобрать время в пути: {text!r}")
        return int(h or 0) * 60 + int(m or 0)


def load_measurements(path) -> pd.DataFrame:
    """CSV с колонками point_id, slot, minutes[, km] → таблица с минутами и скоростью."""
    df = pd.read_csv(path, dtype={"slot": str})
    df["minutes"] = df["minutes"].map(parse_minutes)
    if "km" in df:
        df["speed_kmh"] = df["km"] / (df["minutes"] / 60)
    return df
