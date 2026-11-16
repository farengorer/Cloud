"""Сопоставление выручки по ячейкам H3 (чеки ККТ за неделю) с доступностью по УДС (время до центра, изохроны)."""
import json

import geopandas as gpd
import numpy as np
import pandas as pd

REV = "trunc_revenue_capped_est_rub"  # оценка недельной выручки, руб (средний чек ограничен сверху)
MAX_SNAP_M = 400.0


def load_hex(path):
    g = gpd.read_file(path)
    g["hours"] = g["ActiveHours"].map(lambda s: np.array(json.loads(s), float) if isinstance(s, str) else np.full(24, np.nan))
    g["rev"] = g[REV]
    g["receipts"] = g["ReceiptTotalCount"].astype(float)
    return g


def attach_times(hx, edges_minutes, edges_ratio, forecast_edges):
    pts = gpd.GeoDataFrame(hx[["Id"]].copy(), geometry=hx.geometry.centroid, crs=hx.crs)
    out = hx.copy()
    for path, cols in ((edges_minutes, ["t_0800", "t_1100", "t_1800", "rank", "gap_km"]),
                       (edges_ratio, ["ratio", "diff_min"]),
                       (forecast_edges, ["vc_base", "d_s1", "d_s2"])):
        e = gpd.read_file(path).to_crs(hx.crs)[cols + ["geometry"]]
        j = gpd.sjoin_nearest(pts, e, how="left", max_distance=MAX_SNAP_M, distance_col="snap_m")
        j = j.drop_duplicates("Id").set_index("Id")
        for c in cols:
            out[c] = out["Id"].map(j[c])
        out["snap_" + c] = out["Id"].map(j["snap_m"])
    return out


def report(hx, iso_path, out_dir):
    from pathlib import Path
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import LogNorm

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    d = hx.copy()
    d["peak_am_pct"] = d["hours"].map(lambda h: h[7:10].sum() / np.nansum(h) * 100 if np.isfinite(h).all() and np.nansum(h) > 0 else np.nan)
    d["peak_pm_pct"] = d["hours"].map(lambda h: h[17:20].sum() / np.nansum(h) * 100 if np.isfinite(h).all() and np.nansum(h) > 0 else np.nan)
    d["rev_x_diff_млнмин"] = d["rev"] * d["diff_min"] / 1e6
    d["band_1100"] = pd.cut(d["t_1100"], [0, 10, 20, 30, 45], labels=["до 10", "10–20", "20–30", "30–45"]).astype(str)
    keep = ["Id", "Title", "rev", "receipts", "kkt_cur", "avg_bill", "IsMall", "t_0800", "t_1100", "t_1800", "diff_min", "ratio",
            "vc_base", "d_s1", "d_s2", "rev_x_diff_млнмин", "band_1100", "peak_am_pct", "peak_pm_pct", "geometry"]
    d[keep].rename(columns={"rev": "revenue_week_rub", "receipts": "receipts_week"}).to_crs(4326).to_file(
        out / "revenue_hex_accessibility.gpkg", layer="hex", driver="GPKG")

    t = d.dropna(subset=["t_1100"]).copy()
    band = t.groupby("band_1100").agg(ячеек=("Id", "size"), ячеек_с_выручкой=("rev", "count"), выручка_млн=("rev", lambda s: s.sum() / 1e6),
                                      чеков_на_ячейку=("receipts", "mean"), доля_вечер_17_20_пct=("peak_pm_pct", "mean"),
                                      доля_утро_7_10_пct=("peak_am_pct", "mean")).reindex(["до 10", "10–20", "20–30", "30–45"])
    band["доля_выручки_пct"] = 100 * band["выручка_млн"] / band["выручка_млн"].sum()
    band.round(1).to_csv(out / "revenue_by_time_band.csv")

    iso = gpd.read_file(iso_path, layer="isochrones_0800").to_crs(d.crs)
    pts = gpd.GeoDataFrame(d[["Id", "rev", "receipts"]], geometry=d.geometry.centroid, crs=d.crs)
    rows = []
    for sc in iso.scenario.unique():
        for lev in (10, 20, 30, 45):
            poly = iso[(iso.scenario == sc) & (iso.level_min == lev)].geometry.iloc[0]
            ins = pts.within(poly)
            rows.append(dict(сценарий=sc, уровень_мин=lev, выручка_млн=pts.rev[ins].sum() / 1e6, чеков_тыс=pts.receipts[ins].sum() / 1e3))
    ri = pd.DataFrame(rows)
    ri.round(1).to_csv(out / "revenue_inside_isochrones_0800.csv", index=False)

    fig, axes = plt.subplots(2, 2, figsize=(16, 14), constrained_layout=True)
    ax = axes[0, 0]
    c = d.geometry.centroid
    m = d["rev"].notna()
    sc = ax.scatter(c.x[m] / 1000, c.y[m] / 1000, c=d["rev"][m] / 1e6, s=10 + 60 * (d["rev"][m] / d["rev"].max()) ** 0.5, cmap="plasma_r",
                    norm=LogNorm(0.2, 200), edgecolor="none")
    ax.scatter(c.x[~m] / 1000, c.y[~m] / 1000, s=3, c="#cccccc")
    fig.colorbar(sc, ax=ax, shrink=0.7, label="выручка за неделю, млн ₽")
    ax.set_title("Выручка по ячейкам H3 (серые — без оценки выручки)")
    ax = axes[0, 1]
    mm = t["rev_x_diff_млнмин"].notna()
    sc = ax.scatter(t.geometry.centroid.x[mm] / 1000, t.geometry.centroid.y[mm] / 1000, c=t["diff_min"][mm], s=10 + 60 * (t["rev"][mm] / d["rev"].max()) ** 0.5,
                    cmap="YlOrRd", vmin=0, vmax=16, edgecolor="none")
    fig.colorbar(sc, ax=ax, shrink=0.7, label="потеря утром 08:00 − 11:00, мин")
    ax.set_title("Размер точки — выручка, цвет — потеря времени утром")
    for a in axes[0]:
        a.set_aspect("equal"); a.set_xlim(530, 580) if False else None
    ax = axes[1, 0]
    x = np.arange(len(band))
    ax.bar(x, band["выручка_млн"], color="#4c78a8")
    for xi, (v, pc) in enumerate(zip(band["выручка_млн"], band["доля_выручки_пct"])):
        ax.text(xi, v, f"{pc:.0f} %", ha="center", va="bottom")
    ax.set_xticks(x); ax.set_xticklabels([f"{b}\nмин ({int(n)} яч.)" for b, n in zip(band.index, band["ячеек"])])
    ax.set_ylabel("выручка за неделю, млн ₽"); ax.set_title("Выручка по времени до центра (11:00)")
    ax = axes[1, 1]
    w = 0.27
    p = ri.pivot(index="уровень_мин", columns="сценарий", values="выручка_млн")
    order = [c for c in ("база", "срезка (+33 тыс.)", "полный проект (+180 тыс.)") if c in p.columns]
    for k, (name, col) in enumerate(zip(order, ("#4c78a8", "#f58518", "#e45756"))):
        ax.bar(np.arange(len(p)) + (k - 1) * w, p[name], w, label=name, color=col)
    ax.set_xticks(np.arange(len(p))); ax.set_xticklabels([f"до {l} мин" for l in p.index])
    ax.set_ylabel("выручка внутри изохроны, млн ₽/нед"); ax.legend(); ax.set_title("Выручка внутри изохрон 08:00 в центр: база и проект")
    fig.suptitle("Ярославль: выручка по ККТ за неделю 19–25.10.2026 и доступность", fontsize=12)
    fig.savefig(out / "revenue_vs_accessibility.png", dpi=130)
    plt.close(fig)
    return band, ri, d
