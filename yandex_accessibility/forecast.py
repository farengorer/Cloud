"""Прогноз «до и после»: база (существующее население и МПТ) и проектные сценарии на одной сети УДС.

База калибруется по замерам Яндекса (масштаб спроса θ — по средней «утро/день»); пространственная картина
проверяется независимо (Spearman по точкам). Сценарии: те же θ и λ, меняются только население и МПТ районов."""
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.stats import pearsonr, spearmanr

from . import demand_model as dm
from .calibrate_uds import Net

LAM = 0.08
ITERS = 8
SCEN = {  # название → (колонка населения, колонка МПТ)
    "срезка (+33 тыс.)": ("Население_итог_срезка", "МПТ_итог"),
    "полный проект (+180 тыс.)": ("Население_итог", "МПТ_итог"),
}


def run(path, taz, points_csv, times_csv, out_dir):
    from pathlib import Path
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    net = Net(path)
    cap = dm.edge_capacity(net, path)
    Z = dm.Zones(taz, net)
    g = Z.g[Z.g.snap_km < 3].reset_index(drop=True)
    nodes = g.node.to_numpy()
    t0 = net.base_minutes(0)
    T0 = dm.free_skim(net, nodes, t0)

    pts = pd.read_csv(points_csv).set_index("point_id")
    tt = pd.read_csv(times_csv)
    tt = tt[tt.status == "ok"].pivot(index="point_id", columns="slot", values="minutes").reindex(pts.index)
    pts = pts[tt["08:00"].notna() & tt["11:00"].notna()]
    tt = tt.loc[pts.index]
    pn = np.array([net.idx[(int(x), int(y))] for x, y in zip(pts.x_utm, pts.y_utm)])
    obs_ratio = (tt["08:00"] / tt["11:00"]).to_numpy()
    obs_exc08 = (tt["08:00"] - tt["11:00"]).to_numpy()
    obs_exc18 = (tt["18:00"] - tt["11:00"]).to_numpy()
    a, b = dm.IMP_A, dm.IMP_B

    def sssp(t, to_center):
        A = csr_matrix((t, (net.u, net.v)), shape=(net.n, net.n))
        A = A.T.tocsr() if to_center else A
        return dijkstra(A, directed=True, indices=net.src)

    fr_in, fr_out = sssp(t0, True), sssp(t0, False)

    def simulate(pop, jobs, theta):
        O = pop.astype(float)
        D = jobs / jobs.sum() * O.sum()
        od = dm.gravity(T0, O, D, LAM)
        f_am, t_am = dm.assign(net, od, nodes, t0, cap, theta, ITERS)
        f_pm, t_pm = dm.assign(net, od.T.copy(), nodes, t0, cap, theta, ITERS)  # вечером поток обратный
        return dict(f_am=f_am, t_am=t_am, f_pm=f_pm, t_pm=t_pm,
                    am=sssp(t_am, True), pm=sssp(t_pm, False), od=od)

    pop0 = g["Население_сущ"].to_numpy(float)
    jobs0 = g["МПТ_сущ"].to_numpy(float)
    lo, hi = 0.002, 0.3
    for _ in range(10):  # подбор θ по средней «утро/день» на 139 точках
        mid = (lo * hi) ** 0.5
        s = simulate(pop0, jobs0, mid)
        r = (a * s["am"][pn] + b) / (a * fr_in[pn] + b)
        if r.mean() < obs_ratio.mean():
            lo = mid
        else:
            hi = mid
    theta = (lo * hi) ** 0.5
    base = simulate(pop0, jobs0, theta)
    mr = (a * base["am"][pn] + b) / (a * fr_in[pn] + b)
    exc_am = a * (base["am"][pn] - fr_in[pn])
    exc_pm = a * (base["pm"][pn] - fr_out[pn])
    val = dict(theta=theta, mean_model=float(mr.mean()), mean_obs=float(obs_ratio.mean()),
               sp_ratio=float(spearmanr(mr, obs_ratio)[0]), pe_ratio=float(pearsonr(mr, obs_ratio)[0]),
               sp_exc_am=float(spearmanr(exc_am, obs_exc08)[0]), sp_exc_pm=float(spearmanr(exc_pm, obs_exc18)[0]),
               n_over=int((base["f_am"] / cap > 1).sum()))
    pd.Series(val).to_csv(out / "baseline_validation.csv")

    rows = pts[["label", "role", "straight_km"]].copy()
    rows["Y08_obs"], rows["Y11_obs"], rows["Y18_obs"] = tt["08:00"], tt["11:00"], tt["18:00"]
    rows["exc08_model"], rows["exc18_model"] = exc_am, exc_pm
    edge_cols = {"vc_base_am": base["f_am"] / cap, "vc_base_pm": base["f_pm"] / cap}
    node_delta = {}
    zones_out = g[["Адм_район", "Планировочный_район", "Население_сущ", "МПТ_сущ", "geometry"]].copy()
    for name, (pc, jc) in SCEN.items():
        sc = simulate(g[pc].fillna(0).to_numpy(float), g[jc].fillna(0).to_numpy(float), theta)
        tag = "s1" if name.startswith("срезка") else "s2"
        d_am = a * (sc["am"] - base["am"])
        d_pm = a * (sc["pm"] - base["pm"])
        rows[f"d08_{tag}"] = d_am[pn]
        rows[f"d18_{tag}"] = d_pm[pn]
        rows[f"Y08_{tag}"] = rows["Y08_obs"] + d_am[pn]
        rows[f"Y18_{tag}"] = rows["Y18_obs"] + d_pm[pn]
        edge_cols[f"vc_{tag}_am"] = sc["f_am"] / cap
        edge_cols[f"vc_{tag}_pm"] = sc["f_pm"] / cap
        node_delta[tag] = (d_am, d_pm)
        zones_out[f"Нас_{tag}"] = g[pc].fillna(0).to_numpy(float)
        zones_out[f"МПТ_{tag}"] = g[jc].fillna(0).to_numpy(float)
    rows.to_csv(out / "forecast_points.csv")
    return dict(net=net, cap=cap, g=g, base=base, val=val, rows=rows, edge_cols=edge_cols,
                node_delta=node_delta, zones=zones_out, pts=pts, fr_in=fr_in, fr_out=fr_out)


def report(R, out_dir):
    """Карты, слой рёбер/районов и сводка по районам (только утро: вечерняя картина не проходит проверку)."""
    from pathlib import Path
    import geopandas as gpd
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.collections import LineCollection
    from shapely.geometry import LineString

    out = Path(out_dir)
    net, cap, g, rows, pts = R["net"], R["cap"], R["g"], R["rows"], R["pts"]
    xy = np.array(net.nodes, float)
    u, v = net.u, net.v
    key = np.minimum(u, v) * net.n + np.maximum(u, v)
    d1, d2 = R["node_delta"]["s1"][0], R["node_delta"]["s2"][0]
    e = pd.DataFrame(dict(key=key, u=u, v=v, rank=net.rank, cap=cap,
                          vc_base=R["edge_cols"]["vc_base_am"], vc_s1=R["edge_cols"]["vc_s1_am"], vc_s2=R["edge_cols"]["vc_s2_am"],
                          d_s1=(d1[u] + d1[v]) / 2, d_s2=(d2[u] + d2[v]) / 2))
    e = e.sort_values("vc_base", ascending=False).groupby("key").first().reset_index(drop=True)
    gdf = gpd.GeoDataFrame(e.drop(columns=["u", "v"]), geometry=[LineString([xy[a], xy[b]]) for a, b in zip(e.u, e.v)], crs=32637).to_crs(4326)
    gdf.to_file(out / "forecast_edges.gpkg", layer="edges", driver="GPKG")
    zones = R["zones"].copy()
    zones["dНас_s1"] = zones["Нас_s1"] - zones["Население_сущ"]
    zones["dМПТ_s1"] = zones["МПТ_s1"] - zones["МПТ_сущ"]
    # прирост утреннего времени по району — среднее по замерным точкам внутри района
    sj = gpd.sjoin(gpd.GeoDataFrame(rows[["d08_s1", "d08_s2"]], geometry=gpd.points_from_xy(pts.x_utm, pts.y_utm), crs=32637),
                   gpd.GeoDataFrame(R["zones"][["Адм_район", "geometry"]], crs=32637), how="left", predicate="within")
    zones.to_crs(4326).to_file(out / "forecast_zones.gpkg", layer="zones", driver="GPKG")
    by = sj.groupby("Адм_район")[["d08_s1", "d08_s2"]].agg(["mean", "max", "count"]).round(1)
    by.to_csv(out / "forecast_by_district.csv")

    segs = np.array([[xy[a] / 1000, xy[b] / 1000] for a, b in zip(e.u, e.v)])
    cx, cy = xy[net.src] / 1000
    fig, axes = plt.subplots(1, 3, figsize=(21, 7.8), constrained_layout=True)
    panels = [("база: загрузка утром (v/c), существующее население", "vc_base", "YlOrRd", 0.0, 1.5),
              ("срезка (+33 тыс. чел.): прирост времени до центра утром, мин", "d_s1", "YlOrRd", 0.0, 6.0),
              ("полный проект (+180 тыс.): прирост времени до центра утром, мин", "d_s2", "YlOrRd", 0.0, 25.0)]
    for ax, (title, col, cmap, lo, hi) in zip(axes, panels):
        vals = e[col].to_numpy()
        major = e["rank"].to_numpy() >= 3
        for sel, lw, al in ((~major, 0.4, 0.4), (major, 1.5, 1.0)):
            idx = np.flatnonzero(sel)
            idx = idx[np.argsort(vals[idx])]
            lc = LineCollection(segs[idx], array=vals[idx], cmap=cmap, linewidths=lw, alpha=al)
            lc.set_clim(lo, hi)
            ax.add_collection(lc)
        ax.plot(cx, cy, "s", color="blue", ms=7, zorder=5)
        ax.set_xlim(cx - 21, cx + 21); ax.set_ylim(cy - 21, cy + 21)
        ax.set_aspect("equal"); ax.set_title(title, fontsize=10)
        fig.colorbar(lc, ax=ax, shrink=0.7)
    fig.suptitle("Ярославль: прогноз утреннего пика по районам (существующее → проектное население и МПТ), сеть без изменений", fontsize=11)
    fig.savefig(out / "forecast_maps.png", dpi=140)
    plt.close(fig)

    # проверка базы: модельное «утро/день» против замеренного
    a, b = dm.IMP_A, dm.IMP_B
    fig, ax = plt.subplots(figsize=(5.5, 5))
    mr = 1 + rows["exc08_model"] / (rows["Y11_obs"])
    orr = rows["Y08_obs"] / rows["Y11_obs"]
    ax.scatter(orr, mr, s=14)
    ax.plot([1, 2.4], [1, 2.4], "k--", lw=0.8)
    ax.set_xlabel("замер Яндекса: 08:00 / 11:00"); ax.set_ylabel("модель: 08:00 / 11:00 (база)")
    ax.set_title("Проверка базы по 139 точкам (Spearman %.2f)" % R["val"]["sp_ratio"], fontsize=10)
    fig.savefig(out / "forecast_validation.png", dpi=130, bbox_inches="tight")
    plt.close(fig)
    return by, e


def iso_change(net, models, R, points_csv, out_png, out_gpkg, levels=(10, 20, 30, 45), cover_km=5.0, simplify_m=60.0):
    """Изохроны 08:00 (в центр): база и проектные сценарии. Прирост времени узлов из модели спроса (в шкале Яндекса)
    добавляется к калиброванному времени; контуры строятся тем же способом, что и в базе."""
    import contourpy
    import geopandas as gpd
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from scipy.ndimage import binary_fill_holes, gaussian_filter, label
    from scipy.spatial import cKDTree
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    from .field import Grid
    from .uds_iso import surface

    slot, (a, b, m, l, _), chosen = models["08:00"]
    dist, _, _ = slot.run(m[net.group] * l)
    pts = pd.read_csv(points_csv)
    cx, cy = net.nodes[net.src]
    grid = Grid(cx, cy)
    X, Y = grid.centers()
    q = np.c_[X.ravel(), Y.ravel()]
    d_pt = cKDTree(np.c_[pts.x_utm, pts.y_utm]).query(q)[0].reshape(X.shape) / 1000
    d_road = cKDTree(np.array(net.nodes, float)).query(q)[0].reshape(X.shape) / 1000
    unc = (d_pt > cover_km) | (d_road > 1.5)
    ci, cj = int((cy - grid.y0) // grid.cell), int((cx - grid.x0) // grid.cell)

    def field(delta):
        tm = {net.nodes[i]: dist[i] + (delta[i] / a if delta is not None else 0.0) for i in range(net.n) if np.isfinite(dist[i])}
        return np.where(unc, np.nan, a * surface(grid, None, tm) + b)

    def nested(f):
        out, prev = [], None
        for lev in levels:
            mask = np.nan_to_num(f, nan=1e9) <= lev
            lab, n = label(mask)
            comp = (lab == lab[ci, cj]) if lab[ci, cj] > 0 else (lab == 1 + int(np.argmax(np.bincount(lab.ravel())[1:])))
            comp = binary_fill_holes(comp)
            sm = gaussian_filter(comp.astype(float), 1.0)
            gen = contourpy.contour_generator(grid.xs, grid.ys, sm, fill_type=contourpy.FillType.OuterOffset)
            pl, ol = gen.filled(0.5, 2.0)
            ps = []
            for p, o in zip(pl, ol):
                rings = [p[o[i]:o[i + 1]] for i in range(len(o) - 1)]
                if len(rings[0]) >= 4:
                    ps.append(Polygon(rings[0], [r for r in rings[1:] if len(r) >= 4]))
            geom = unary_union(ps).simplify(simplify_m)
            if prev is not None:
                geom = unary_union([geom, prev])
            prev = geom
            out.append(geom)
        return out

    sc = {"база": None, "срезка (+33 тыс.)": R["node_delta"]["s1"][0], "полный проект (+180 тыс.)": R["node_delta"]["s2"][0]}
    geoms = {k: nested(field(v)) for k, v in sc.items()}
    rows = []
    for k, gl in geoms.items():
        for lev, ge in zip(levels, gl):
            rows.append(dict(scenario=k, level_min=lev, area_km2=ge.area / 1e6, geometry=ge))
    gdf = gpd.GeoDataFrame(rows, crs=32637)
    tab = gdf.pivot(index="level_min", columns="scenario", values="area_km2")[list(sc)].round(1)
    tab["срезка, Δ %"] = ((tab["срезка (+33 тыс.)"] / tab["база"] - 1) * 100).round(1)
    tab["полный, Δ %"] = ((tab["полный проект (+180 тыс.)"] / tab["база"] - 1) * 100).round(1)
    tab.to_csv(str(out_png).rsplit(".", 1)[0] + "_areas.csv")
    gdf.to_crs(4326).to_file(out_gpkg, layer="isochrones_0800", driver="GPKG")

    fig, axes = plt.subplots(1, 2, figsize=(15, 8), constrained_layout=True)
    cols = {10: "#41ab5d", 20: "#2171b5", 30: "#d94801", 45: "#6a51a3"}
    for ax, name in zip(axes, ("срезка (+33 тыс.)", "полный проект (+180 тыс.)")):
        for lev, g0, g1 in zip(levels, geoms["база"], geoms[name]):
            for geom, ls, lw, al in ((g0, "-", 1.4, 1.0), (g1, "--", 2.0, 1.0)):
                for pg in getattr(geom, "geoms", [geom]):
                    x, y = pg.exterior.xy
                    ax.plot(np.array(x) / 1000, np.array(y) / 1000, ls, color=cols[lev], lw=lw, alpha=al)
        ax.plot(cx / 1000, cy / 1000, "s", color="red", ms=7)
        ax.set_xlim(cx / 1000 - 24, cx / 1000 + 24); ax.set_ylim(cy / 1000 - 24, cy / 1000 + 24)
        ax.set_aspect("equal"); ax.set_title(f"{name}: изохроны 08:00 в центр\nсплошная — база, пунктир — проект (сеть без изменений)")
        from matplotlib.lines import Line2D
        ax.legend(handles=[Line2D([0], [0], color=cols[lv], lw=2, label=f"{lv} мин") for lv in levels], loc="lower left")
    fig.suptitle("Ярославль: изменение изохрон утром в проекте (население и МПТ по районам)", fontsize=11)
    fig.savefig(out_png, dpi=140)
    plt.close(fig)
    return tab
