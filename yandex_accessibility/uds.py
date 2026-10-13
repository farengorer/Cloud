"""100 точек замера на узлах УДС Ярославля (слой УДС из gpkg) и ссылки для Яндекс Карт.

Состав: 48 базовых (8 направлений × 6 колец) + 2 близкие + посёлки/ЖК + заполнение пробелов.
Часть точек помечена `holdout` — их держат вне подгонки для независимой проверки.
Замеры: 08:00 и 11:00 — из центра в точку; 18:00 — из точки в центр."""
import html
import re
from urllib.parse import quote

import geopandas as gpd
import networkx as nx
import numpy as np
import pandas as pd
from pyproj import Transformer
from scipy.spatial import cKDTree

from .config import BEARINGS, NEAR_POINTS, RING_KM

EPSG = 32637
CENTER_NAME = "Богоявленская площадь"
SLOTS = (("08:00", "from_center"), ("11:00", "from_center"), ("18:00", "to_center"))
DEFAULT_DATE = "2026-10-20"  # вторник, будущий будний день
N_TOTAL = 100
HOLDOUT_SHARE = 0.2
MIN_SPACING_M = 1500.0  # минимум между точками
MAX_SNAP_KM = 6.0  # дальше от идеальной цели кольца точку не берём (в слое нет дорог)
FAR_RING_KM = 18  # с этого кольца допускаем узлы степени 2

# Ранг класса дороги: узел берёт максимум по инцидентным рёбрам.
CLASS_RANK = {
    "а/д федерального значения": 6,
    "а/д регионального или межмуниципального значения": 5,
    "магистральные улицы общегородского значения регулируемая": 5,
    "магистральные улицы районного значения": 4,
    "Съезды транспортной развязки ф": 4, "Съезды транспортной развязки р": 4, "Съезды транспортной развязки г": 3,
    "улица местного значения": 3,
    "прочее": 1, "квартальные проезды": 1, "пешеходные улицы": 0,
}
MIN_RANK_BASE = 3  # базовые точки — только на улицах не ниже местного значения

# Тип поселения даёт вес вместо числа жилых единиц (в слое их нет): длина дорог × вес.
SETTLEMENT_RE = re.compile(r"^(посёлок|поселок|пос\.|деревня|село|жк|микрорайон|снт|ст |садовое|днт|кп )", re.I)
GARDEN_RE = re.compile(r"^(снт|ст |садовое|днт)", re.I)


def load_network(path, center_lonlat):
    """Граф УДС: узлы — концы сегментов (1 м), рёбра — сегменты; one_way=1 — по направлению геометрии."""
    gdf = gpd.read_file(path).to_crs(EPSG)
    key = lambda p: (round(p[0]), round(p[1]))
    G = nx.DiGraph()
    node_rank, node_deg, node_barrier, node_names = {}, {}, set(), {}
    for r in gdf.itertuples():
        rank = CLASS_RANK.get(r.classid, 1)
        adr = (r.adress or "").strip() if isinstance(r.adress, str) else ""
        for ls in r.geometry.geoms:
            c = list(ls.coords)
            a, b = key(c[0]), key(c[-1])
            if a == b:
                continue
            if rank > 0:  # пешеходные улицы автомобилю недоступны
                G.add_edge(a, b, length=ls.length, rank=rank)
                if not r.one_way:
                    G.add_edge(b, a, length=ls.length, rank=rank)
            for n in (a, b):
                node_rank[n] = max(node_rank.get(n, 0), rank)
                node_deg[n] = node_deg.get(n, 0) + 1
                if r.barrier == 1:
                    node_barrier.add(n)
                if adr:
                    node_names.setdefault(n, set()).add(adr)
    scc = max(nx.strongly_connected_components(G), key=len)
    nodes = sorted(scc)
    attrs = pd.DataFrame({
        "x": [n[0] for n in nodes], "y": [n[1] for n in nodes],
        "rank": [node_rank[n] for n in nodes],
        "deg": [node_deg[n] for n in nodes],
        "barrier": [n in node_barrier for n in nodes],
        "adress": [sorted(node_names.get(n, [])) for n in nodes],
    })
    cx, cy = Transformer.from_crs(4326, EPSG, always_xy=True).transform(*center_lonlat)
    return G.subgraph(scc).copy(), attrs, (cx, cy)


def center_from_layer(path):
    """Центр — центроид сегментов улицы «Богоявленская площадь» в слое (lon, lat)."""
    gdf = gpd.read_file(path)
    sel = gdf[gdf["name"] == CENTER_NAME]
    if sel.empty:
        raise ValueError(f"в слое нет улицы «{CENTER_NAME}»")
    c = sel.geometry.union_all().centroid
    return c.x, c.y


def _settlement_name(adr):
    adr = re.sub(r"\s+", " ", adr).strip()
    if "Промзона" in adr or adr.startswith("от ") or not SETTLEMENT_RE.match(adr):
        return None
    return adr


def select(path, n_total=N_TOTAL, seed=7):
    center_ll = center_from_layer(path)
    G, nd, (cx, cy) = load_network(path, center_ll)
    xy = nd[["x", "y"]].to_numpy(float)
    dist_c = np.hypot(xy[:, 0] - cx, xy[:, 1] - cy)

    gdf = gpd.read_file(path)
    gdf["settle"] = gdf["adress"].map(lambda a: _settlement_name(a) if isinstance(a, str) else None)
    sett_len = gdf.dropna(subset=["settle"]).groupby("settle")["length"].sum()

    base_ok = ((nd["deg"] >= 3) & (nd["rank"] >= MIN_RANK_BASE) & ~nd["barrier"] & (dist_c > 300)).to_numpy()
    base_idx = np.flatnonzero(base_ok)
    tree = cKDTree(xy[base_idx])
    far_ok = ((nd["deg"] >= 2) & (nd["rank"] >= MIN_RANK_BASE) & ~nd["barrier"] & (dist_c > 300)).to_numpy()
    far_idx = np.flatnonzero(far_ok)
    far_tree = cKDTree(xy[far_idx])
    skipped = []

    chosen, rows = [], []

    spacing = MIN_SPACING_M

    def add(i, label, role, **extra):
        i = int(i)
        if i in chosen or any(np.hypot(*(xy[i] - xy[j])) < spacing for j in chosen):
            return False
        chosen.append(i)
        rows.append({"label": label, "role": role, "node_idx": i, **extra})
        return True

    # 1. базовые: 8 направлений × 6 колец и две близкие точки
    targets = [(f"{n}-{km}", az, km, "base") for km in RING_KM for n, az in BEARINGS.items()]
    targets += [(lbl, az, km, "base_near") for lbl, az, km in NEAR_POINTS]
    for label, az, km, role in targets:
        tx, ty = cx + km * 1000 * np.sin(np.radians(az)), cy + km * 1000 * np.cos(np.radians(az))
        idx, tr = (far_idx, far_tree) if km >= FAR_RING_KM else (base_idx, tree)
        d, order = tr.query([tx, ty], k=30, distance_upper_bound=MAX_SNAP_KM * 1000)
        for dd, o in zip(d, order):
            if np.isfinite(dd) and add(idx[o], label, role, bearing=az, ring_km=km, snap_km=dd / 1000):
                break
        else:
            skipped.append(label)

    # 2. посёлки/ЖК: по убыванию веса (длина дорог × тип), узел — ближайший к центру поселения
    n_sett = min(30, n_total - len(rows) - 20)
    weights = {n: ln * (0.4 if GARDEN_RE.match(n) else 1.0) for n, ln in sett_len.items()}
    sett_nodes = {}
    for i, adrs in enumerate(nd["adress"]):
        for a in adrs:
            nm = _settlement_name(a)
            if nm:
                sett_nodes.setdefault(nm, []).append(i)
    got = 0
    for name in sorted(weights, key=weights.get, reverse=True):
        if got >= n_sett:
            break
        idxs = [i for i in sett_nodes.get(name, []) if dist_c[i] > 3000 and not nd["barrier"][i]]
        if not idxs:
            continue
        pts = xy[idxs]
        i = idxs[int(np.argmin(np.hypot(*(pts - pts.mean(0)).T)))]
        if add(i, name, "settlement", settlement=name, weight_km=weights[name]):
            got += 1

    # 3. заполнение пробелов: самый удалённый от выбранных узел внутри круга 30 км
    cand = np.flatnonzero(base_ok & (dist_c > 3000) & (dist_c <= 30000))
    while len(rows) < n_total:
        dmin = cKDTree(xy[chosen]).query(xy[cand])[0]
        for o in np.argsort(-dmin):
            if add(cand[o], f"gap-{len(rows) + 1}", "gap"):
                break
        else:
            spacing *= 0.7  # узлов не осталось — сближаем допустимое расстояние между точками
            if spacing < 300:
                raise RuntimeError(f"не удалось набрать точки: {len(rows)} из {n_total}")

    df = pd.DataFrame(rows)
    df.insert(0, "point_id", np.arange(1, len(df) + 1))
    i = df["node_idx"].to_numpy()
    df["x_utm"], df["y_utm"] = xy[i, 0], xy[i, 1]
    df["lon"], df["lat"] = Transformer.from_crs(EPSG, 4326, always_xy=True).transform(df["x_utm"], df["y_utm"])
    df["straight_km"] = dist_c[i] / 1000
    df["azimuth"] = (np.degrees(np.arctan2(xy[i, 0] - cx, xy[i, 1] - cy)) + 360) % 360
    df["node_class_rank"], df["node_deg"] = nd["rank"].to_numpy()[i], nd["deg"].to_numpy()[i]
    df["snap_km"] = df["snap_km"].fillna(0.0)  # сдвиг от идеальной цели; для остальных ролей не применим
    df = df.drop(columns=["node_idx"])

    # holdout: ~20 % внутри каждой роли, чтобы проверка охватывала все типы точек
    rng = np.random.default_rng(seed)
    df["holdout"] = False
    for _, g in df.groupby("role"):
        df.loc[rng.choice(g.index, size=max(1, round(len(g) * HOLDOUT_SHARE)), replace=False), "holdout"] = True
    df.attrs["center_lonlat"] = center_ll
    df.attrs["skipped_rings"] = skipped
    return df


def route_url(src, dst, date, slot):
    """src, dst — (lat, lon). Яндекс принимает rtext в порядке «широта,долгота»."""
    t = quote(f"{date}T{slot}:00", safe="")
    return (
        "https://yandex.ru/maps/?mode=routes&rtt=auto"
        f"&rtext={src[0]:.6f},{src[1]:.6f}~{dst[0]:.6f},{dst[1]:.6f}"
        f"&routes%5BtimeDependent%5D%5Btime%5D={t}"
    )


def links(df, center_lonlat, date=DEFAULT_DATE):
    c = (center_lonlat[1], center_lonlat[0])
    rows = []
    for p in df.itertuples():
        pt = (p.lat, p.lon)
        for slot, direction in SLOTS:
            src, dst = (c, pt) if direction == "from_center" else (pt, c)
            rows.append({"point_id": p.point_id, "label": p.label, "slot": slot, "direction": direction,
                         "url": route_url(src, dst, date, slot)})
    return pd.DataFrame(rows)


def write_html(df, lk, date, path):
    """Страница ручного ввода «минуты|км»; CSV: point_id,slot,direction,minutes,km."""
    byk = {(r.point_id, r.slot): r for r in lk.itertuples()}
    head = "".join(f"<th>{s} ({'из центра' if d == 'from_center' else 'в центр'})</th>" for s, d in SLOTS)
    body = []
    for p in df.itertuples():
        cells = "".join(
            f'<td><a href="{html.escape(byk[p.point_id, s].url)}" target="_blank">открыть</a> '
            f'<input size="9" data-id="{p.point_id}" data-slot="{s}" data-dir="{d}" placeholder="мин|км"></td>'
            for s, d in SLOTS)
        body.append(f"<tr><td>{p.point_id}</td><td>{html.escape(p.label)}</td><td>{p.straight_km:.1f}</td>"
                    f"<td>{'вне подгонки' if p.holdout else ''}</td>{cells}</tr>")
    page = f"""<!doctype html><meta charset="utf-8"><title>Замеры Яндекс Карт — Ярославль</title>
<style>body{{font:14px sans-serif;margin:16px}}td,th{{padding:3px 8px;border-bottom:1px solid #ddd}}</style>
<h1>Ярославль, центр — {CENTER_NAME}: замеры на {date}</h1>
<p>В каждой ссылке возьмите первый (самый быстрый) маршрут на авто, убедитесь, что «Отправление …» совпадает
с заголовком столбца, и впишите «минуты|км».</p>
<table><tr><th>№</th><th>точка</th><th>по прямой, км</th><th></th>{head}</tr>{''.join(body)}</table>
<p><button onclick="dl()">Скачать CSV</button></p>
<script>
function dl(){{
  let out=['point_id,slot,direction,minutes,km'];
  document.querySelectorAll('input').forEach(i=>{{
    const v=i.value.trim().replace(',','.'); if(!v) return;
    const [m,k]=v.split('|'); out.push([i.dataset.id,i.dataset.slot,i.dataset.dir,m,k||''].join(','));
  }});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([out.join('\\n')],{{type:'text/csv'}}));
  a.download='travel_times.csv'; a.click();
}}
</script>"""
    with open(path, "w", encoding="utf-8") as f:
        f.write(page)


def main(path, out_dir, date=DEFAULT_DATE):
    from pathlib import Path
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    df = select(path)
    lk = links(df, df.attrs["center_lonlat"], date)
    df.to_csv(out / "points_uds.csv", index=False)
    lk.to_csv(out / "yandex_links.csv", index=False)
    gpd.GeoDataFrame(df, geometry=gpd.points_from_xy(df["lon"], df["lat"]), crs=4326).to_file(
        out / "points_uds.gpkg", layer="points", driver="GPKG")
    write_html(df, lk, date, out / "points_yandex.html")
    print(df["role"].value_counts().to_string())
    print(f"holdout: {int(df['holdout'].sum())}; центр: {df.attrs['center_lonlat'][::-1]}")
    print("кольца без дорог в слое (заменены заполнением):", ", ".join(df.attrs["skipped_rings"]))
    return df
