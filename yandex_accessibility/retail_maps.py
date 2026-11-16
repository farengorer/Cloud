"""Две карты: (1) экономический приоритет дорог; (2) места, где торговля перспективна по транспортной доступности."""
import numpy as np
import pandas as pd
import geopandas as gpd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
from scipy.cluster.hierarchy import fcluster, linkage

XLIM, YLIM = (542, 563), (6374, 6402)


def background(ax, uds):
    segs = []
    for g in uds.geometry:
        for ls in g.geoms:
            c = np.array(ls.coords) / 1000
            segs.append(c)
    ax.add_collection(LineCollection(segs, colors="#d4d4d4", linewidths=0.35, zorder=1))


def road_priority_map(uds_path, edges_path, named_path, out_png, out_csv):
    uds = gpd.read_file(uds_path).to_crs(32637)
    e = gpd.read_file(edges_path).to_crs(32637)
    nm = gpd.read_file(named_path).to_crs(32637).dropna(subset=["exposure"])
    fig, (ax, ax2) = plt.subplots(1, 2, figsize=(17, 9.5), gridspec_kw=dict(width_ratios=[1.55, 1]), constrained_layout=True)
    background(ax, uds)
    segs = np.array([list(g.coords)[:2] for g in e.geometry]) / 1000
    v = e["exposure"].to_numpy()
    o = np.argsort(v)
    lc = LineCollection(segs[o], array=np.log10(v[o] + 1e-3), cmap="YlOrRd", linewidths=0.8 + 5.5 * (v[o] / v.max()) ** 0.45, zorder=3)
    lc.set_clim(-1.5, 1.9)
    ax.add_collection(lc)
    st = nm.assign(nm_=nm["name"].fillna("(без названия)")).groupby("nm_").agg(
        сегментов=("id", "size"), длина_км=("length", "sum"), выручка_за_дорогой_млн=("W_млн", "max"),
        задержка_мин=("delay_мин", "sum"), экспозиция=("exposure", "sum")).sort_values("экспозиция", ascending=False)
    st = st[st.index != "(без названия)"]
    st["доля_%"] = 100 * st["экспозиция"] / nm["exposure"].sum()
    top = st.head(8)
    for k, name in enumerate(top.index, 1):
        seg = nm[nm["name"] == name].sort_values("exposure").iloc[-1].geometry.centroid
        ax.annotate(str(k), (seg.x / 1000, seg.y / 1000), fontsize=11, weight="bold", ha="center", va="center", zorder=6,
                    bbox=dict(boxstyle="circle,pad=0.25", fc="white", ec="#444444", lw=1))
    ax.set_xlim(*XLIM); ax.set_ylim(*YLIM); ax.set_aspect("equal")
    ax.set_title("Где задержка на дороге дороже всего для торговли (утро)", fontsize=13)
    ax.set_xlabel("км (UTM 37N)")
    cb = fig.colorbar(lc, ax=ax, shrink=0.55, pad=0.01)
    cb.set_label("насколько дорога «важна для денег»: чем темнее и толще, тем больше")
    cb.set_ticks([])
    ax2.axis("off")
    lines = ["Как читать схему", "",
             "Для каждой дороги берём два числа:",
             "• сколько торговли «за ней»: недельная выручка",
             "   магазинов, чей путь к центру идёт по дороге;",
             "• сколько минут теряется на ней утром",
             "   из-за загрузки (пробки).",
             "Перемножаем. Толстая тёмная дорога —",
             "и за ней много торговли, и там заметная пробка.",
             "Узкое место здесь — это не просто «пробка»,",
             "а пробка, которая бьёт по деньгам.", "", "Топ-8 улиц (доля от суммы по городу):", ""]
    for k, (name, r) in enumerate(top.iterrows(), 1):
        lines.append(f"{k}. {name.replace(' (Нефтяников)', '')}: {r['доля_%']:.0f} %  (за дорогой до {r['выручка_за_дорогой_млн']:.0f} млн ₽/нед,"
                     f" ~{r['задержка_мин']:.0f} мин)")
    lines += ["", "Расчёт по модели спроса (проверена по замерам", "Яндекса, утро), выручка — ККТ за неделю 19–25.10.2026."]
    ax2.text(0, 1, "\n".join(lines), va="top", ha="left", fontsize=11.5, family="DejaVu Sans")
    fig.savefig(out_png, dpi=140)
    plt.close(fig)
    st.round(2).to_csv(out_csv)
    return st


def perspective(N, hx, uds, edges_minutes, out_png, out_csv, out_gpkg):
    d = N[(N["rank"] >= 3) & N["dens"].notna() & (N["flow"] > 0)].copy()
    X = np.c_[np.ones(len(d)), np.log1p(d["flow"]), np.log(d["dens"] + 1)]
    y = np.log1p(d["receipts"])
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    d["exp_log"] = X @ beta
    d["gap"] = d["exp_log"] - y  # >0: торговли меньше, чем бывает при таком потоке и плотности
    d["expected_receipts"] = np.expm1(d["exp_log"])
    p_flow = d["flow"].rank(pct=True)
    p_dens = d["dens"].rank(pct=True)
    d["score"] = np.where((p_flow >= 0.6) & (p_dens >= 0.6) & (d["gap"] > 0), d["gap"] * np.sqrt(p_flow * p_dens), 0.0)
    cand = d[d["score"] > 0].nlargest(400, "score").copy()
    Z = linkage(cand[["x", "y"]].to_numpy(), "single")
    cand["cl"] = fcluster(Z, t=500, criterion="distance")
    cl = cand.groupby("cl").agg(узлов=("x", "size"), x=("x", "mean"), y=("y", "mean"), flow=("flow", "max"), receipts=("receipts", "mean"),
                                expected=("expected_receipts", "mean"), score=("score", "sum"), dens=("dens", "mean"),
                                район=("район", lambda s: s.mode().iloc[0] if s.notna().any() else "—")).query("узлов>=3")
    cl = cl.sort_values("score", ascending=False).head(12).reset_index(drop=True)
    cl.index += 1
    cl["потенциал_чеков_нед"] = (cl["expected"] - cl["receipts"]).clip(lower=0)
    # названия улиц и время до центра
    pts = gpd.GeoDataFrame(cl, geometry=gpd.points_from_xy(cl.x, cl.y), crs=32637)
    named = uds[uds["name"].notna()][["name", "geometry"]]
    pts = gpd.sjoin_nearest(pts, named, how="left").drop_duplicates(subset=["x", "y"])
    em = gpd.read_file(edges_minutes).to_crs(32637)[["t_1100", "t_0800", "geometry"]]
    pts = gpd.sjoin_nearest(pts.drop(columns="index_right"), em, how="left").drop_duplicates(subset=["x", "y"])
    pts = pts.sort_values("score", ascending=False).reset_index(drop=True)
    pts.index += 1
    out = pts[["район", "name", "flow", "receipts", "expected", "потенциал_чеков_нед", "dens", "t_1100", "t_0800", "score"]].rename(
        columns={"name": "улица_рядом", "flow": "поток_авт_ч", "receipts": "чеков_нед_рядом_сейчас", "expected": "чеков_нед_ожидаемо",
                 "dens": "плотность_нас+МПТ_на_км2", "t_1100": "до_центра_11_мин", "t_0800": "до_центра_08_мин"})
    out.round(1).to_csv(out_csv)
    gpd.GeoDataFrame(d.drop(columns=["район"]), geometry=gpd.points_from_xy(d.x, d.y), crs=32637).to_crs(4326).to_file(out_gpkg, layer="nodes", driver="GPKG")

    r2 = 1 - ((y - d["exp_log"]) ** 2).sum() / ((y - y.mean()) ** 2).sum()
    fig, (ax, ax2) = plt.subplots(1, 2, figsize=(18, 10), gridspec_kw=dict(width_ratios=[1.35, 1]), constrained_layout=True)
    background(ax, uds)
    c = hx.geometry.centroid
    ax.scatter(c.x / 1000, c.y / 1000, s=4 + 90 * (hx["receipts"] / hx["receipts"].max()) ** 0.5, c="#4c78a8", alpha=0.30, edgecolor="none", zorder=2,
               label="торговля сейчас (размер — чеки за неделю)")
    vmax = cand["score"].quantile(0.9)
    sc = ax.scatter(cand["x"] / 1000, cand["y"] / 1000, s=18 + 60 * (cand["score"] / cand["score"].max()) ** 0.5, c=cand["score"], cmap="YlOrRd", vmin=0, vmax=vmax,
                    edgecolor="#555555", linewidth=0.3, zorder=4, label="узлы УДС с недостатком торговли")
    for k in out.index:
        row = pts.loc[k]
        ax.annotate(str(k), (row.x / 1000, row.y / 1000), fontsize=9, weight="bold", ha="center", va="center", zorder=6, xytext=(0, 14), textcoords="offset points",
                    bbox=dict(boxstyle="circle,pad=0.22", fc="#fff2a8", ec="#a00000", lw=1.1),
                    arrowprops=dict(arrowstyle="-", color="#a00000", lw=0.8))
    ax.set_xlim(*XLIM); ax.set_ylim(*YLIM); ax.set_aspect("equal")
    ax.set_title("Места, где торговля перспективна по транспорту", fontsize=13)
    ax.legend(loc="lower left", fontsize=9)
    fig.colorbar(sc, ax=ax, shrink=0.5, pad=0.01, label="перспективность (выше — лучше)")
    ax2.axis("off")
    lines = ["Как это посчитано", "",
             "Для каждого перекрёстка берём три вещи:",
             "• транспортный поток рядом (модель, утро);",
             "• плотность жителей и рабочих мест в районе;",
             "• торговлю в радиусе 400 м (чеки за неделю).",
             "По всему городу видим, сколько торговли обычно",
             "бывает при таком потоке и такой плотности",
             "(модель объясняет %.0f %% различий)." % (100 * r2),
             "Перспективное место — где поток и жители есть,",
             "а магазинов заметно меньше обычного.", "",
             "Топ мест (чеков/нед: сейчас → обычно бывает):", ""]
    for k, r in out.iterrows():
        lines.append(f"{k}. {r['улица_рядом']} ({r['район'].replace(' район', '')}): {r['чеков_нед_рядом_сейчас']:.0f} → {r['чеков_нед_ожидаемо']:.0f};"
                     f" поток {r['поток_авт_ч']:.0f} авт/ч; до центра {r['до_центра_11_мин']:.0f} мин")
    lines += ["", "Это места-кандидаты для проверки на месте", "(арендные ставки, площади, конкуренты не учтены)."]
    ax2.text(0, 1, "\n".join(lines), va="top", ha="left", fontsize=10.5)
    fig.savefig(out_png, dpi=140)
    plt.close(fig)
    print("R2 модели торговли: %.2f" % r2)
    return out, beta
