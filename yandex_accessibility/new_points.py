"""Дополнительные точки замера (101+) там, где они сильнее всего уточняют модель.

1) bottleneck — перекрёстки с наибольшей «нагрузкой» дерева кратчайших путей к центру (переправы, въезды в центр);
2) gradient   — середины между близкими точками, у которых разница «утро − день» сильнее всего различается;
3) outlier    — перекрёстки в 2–3,5 км от точек с самой большой невязкой калиброванной модели.
Все точки — на перекрёстках не ниже улицы местного значения, не ближе MIN_SPACING_M друг к другу и к старым точкам."""
import numpy as np
import pandas as pd
from pyproj import Transformer
from scipy.spatial import cKDTree
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

from .calibrate_uds import Net
from .uds import EPSG, MIN_RANK_BASE, center_from_layer, links, load_network, write_html

MIN_SPACING_M = 600.0
N_BOTTLENECK, N_GRADIENT, N_OUTLIER = 15, 15, 10


def tree_load(net):
    """Размер поддерева каждого узла в дереве кратчайших путей к центру (свободный поток)."""
    A = csr_matrix((net.base_minutes(0), (net.u, net.v)), shape=(net.n, net.n)).T.tocsr()
    dist, pred = dijkstra(A, directed=True, indices=net.src, return_predecessors=True)
    load = np.ones(net.n)
    order = np.argsort(-np.where(np.isfinite(dist), dist, -1))
    for i in order:
        if pred[i] >= 0:
            load[pred[i]] += load[i]
    return load


def select(path, points_csv, times_csv, resid_csv):
    net = Net(path)
    _, nd, _ = load_network(path, center_from_layer(path))
    xy = np.array(net.nodes, float)
    ok = ((nd["deg"] >= 3) & (nd["rank"] >= MIN_RANK_BASE) & ~nd["barrier"] & (net.dist_c > 800) & (net.dist_c <= 30000)).to_numpy()
    old = pd.read_csv(points_csv).set_index("point_id")
    ox, oy = old.x_utm.to_numpy(float), old.y_utm.to_numpy(float)
    chosen, rows = [], []

    def free(i, spacing=MIN_SPACING_M):
        if not ok[i]:
            return False
        d_old = np.hypot(ox - xy[i, 0], oy - xy[i, 1]).min()
        d_new = min((np.hypot(*(xy[i] - xy[j])) for j in chosen), default=1e9)
        return d_old >= spacing and d_new >= spacing

    def add(i, role, note):
        chosen.append(i)
        rows.append(dict(role=role, note=note, node=i))

    # 1. узкие места
    load = tree_load(net)
    for i in np.argsort(-load):
        if len([r for r in rows if r["role"] == "bottleneck"]) >= N_BOTTLENECK:
            break
        if 1000 <= net.dist_c[i] <= 12000 and free(i, 1000.0):
            add(i, "bottleneck", f"нагрузка дерева путей {int(load[i])}")

    # 2. перепад разницы утро/день между близкими точками
    t = pd.read_csv(times_csv).pivot(index="point_id", columns="slot", values="minutes").reindex(old.index)
    diff = (t["08:00"] - t["11:00"]).to_numpy(float)
    P = np.c_[ox, oy]
    cand = []
    for a in range(len(P)):
        for b in range(a + 1, len(P)):
            d = np.hypot(*(P[a] - P[b]))
            if 1500 <= d <= 4500:
                cand.append((abs(diff[a] - diff[b]) / (d / 1000) ** 0.5, a, b))
    cand.sort(reverse=True)
    tree = cKDTree(xy[ok])
    okidx = np.flatnonzero(ok)
    for score, a, b in cand:
        if len([r for r in rows if r["role"] == "gradient"]) >= N_GRADIENT:
            break
        mid = (P[a] + P[b]) / 2
        for o in tree.query(mid, k=8)[1]:
            i = okidx[o]
            if np.hypot(*(xy[i] - mid)) < 2000 and free(i):
                add(i, "gradient", f"между точками {old.index[a]} и {old.index[b]}: разница {diff[a]:.0f} и {diff[b]:.0f} мин")
                break

    # 3. окрестности самых больших невязок
    res = pd.read_csv(resid_csv)
    bad = res.groupby("point_id").err_chosen.apply(lambda s: s.abs().mean()).sort_values(ascending=False)
    for pid in bad.index:
        if len([r for r in rows if r["role"] == "outlier"]) >= N_OUTLIER:
            break
        px, py = old.loc[pid, ["x_utm", "y_utm"]].astype(float)
        d = np.hypot(xy[:, 0] - px, xy[:, 1] - py)
        for i in np.flatnonzero(ok & (d >= 2000) & (d <= 3500)):
            if free(i):
                add(i, "outlier", f"рядом с точкой {pid} (ср. невязка {bad[pid]:.1f} мин)")
                break

    df = pd.DataFrame(rows)
    i = df["node"].to_numpy()
    start = int(old.index.max()) + 1
    df.insert(0, "point_id", np.arange(start, start + len(df)))
    df["label"] = [f"{r}-{k}" for r, k in zip(df.role, df.point_id)]
    df["x_utm"], df["y_utm"] = xy[i, 0], xy[i, 1]
    df["lon"], df["lat"] = Transformer.from_crs(EPSG, 4326, always_xy=True).transform(df.x_utm, df.y_utm)
    df["straight_km"] = net.dist_c[i] / 1000
    df["holdout"] = False
    rng = np.random.default_rng(11)
    for _, g in df.groupby("role"):
        df.loc[rng.choice(g.index, size=max(1, round(len(g) * 0.2)), replace=False), "holdout"] = True
    df = df.drop(columns=["node"])
    df.attrs["center_lonlat"] = center_from_layer(path)
    return df


def main(out_dir="results/yaroslavl/extra", date="2026-10-20"):
    from pathlib import Path
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    df = select("data/yaroslavl/uds.gpkg", "results/yaroslavl/points_uds.csv", "results/yaroslavl/travel_times.csv",
                "results/yaroslavl/residuals_uds.csv")
    lk = links(df, df.attrs["center_lonlat"], date)
    df.to_csv(out / "points_extra.csv", index=False)
    lk.to_csv(out / "yandex_links_extra.csv", index=False)
    lines = ["# Дополнительные точки замера (101+): ссылки по точкам", "",
             "Центр: Богоявленская площадь. Дата: 2026-10-20. 08:00 и 11:00 — из точки в центр, 18:00 — из центра в точку.", ""]
    byk = {(r.point_id, r.slot): r.url for r in lk.itertuples()}
    for p in df.itertuples():
        lines += [f"## Точка {p.point_id} ({p.role}) — {p.lat:.6f}, {p.lon:.6f}", "", f"_{p.note}_", ""]
        for s in ("08:00", "11:00", "18:00"):
            lines += [f"{s} точка {p.point_id}: {byk[p.point_id, s]}", ""]
    (out / "yandex_links_by_point_extra.md").write_text("\n".join(lines), encoding="utf-8")
    return df
