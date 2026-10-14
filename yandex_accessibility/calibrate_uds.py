"""Калибровка времени по графу УДС по замерам Яндекса (режим Б) и поправки УДС.

Для каждого среза отдельно:
  1) глобальная подгонка  T_Яндекс ≈ a·T + b  (МНК по обучающим точкам);
  2) групповая поправка: рёбра = класс дороги × зона от центра; остаток раскладывается ридж-регрессией,
     время группы умножается на (1+δ), δ ограничена; пути пересчитываются 4 раза;
  3) локальная поправка поверх групповой: остатки сглаживаются по сетевому расстоянию и дают множитель
     0,8–1,25 на время рёбер рядом.
Поправка принимается, только если «одна точка вне выборки» (LOO) даёт меньшую ошибку, чем предыдущий
вариант; holdout-точки в подгонку и в выбор не входят."""
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

from .uds import center_from_layer, load_network
from .uds_iso import SPEEDS

ZONES_M = (3000, 8000, 15000)  # границы зон: 0–3, 3–8, 8–15, >15 км
RANKS = (1, 3, 4, 5, 6)
SLOTS = {"08:00": (1, True), "11:00": (0, True), "18:00": (1, False)}  # (час пик?, к центру?)
N_ITER = 4
DELTA_STEP, M_LO, M_HI = 0.3, 0.5, 2.0
LOCAL_SIGMA_M, LOCAL_K0, L_LO, L_HI = 3000.0, 1.0, 0.8, 1.25
LAMBDAS = (10.0, 100.0, 1000.0)


class Net:
    def __init__(self, path):
        ll = center_from_layer(path)
        G, nd, (cx, cy) = load_network(path, ll)
        self.nodes = [(int(x), int(y)) for x, y in zip(nd.x, nd.y)]
        self.idx = {n: i for i, n in enumerate(self.nodes)}
        ok = (nd["deg"] >= 3) & ~nd["barrier"]
        j = np.hypot(nd.x - cx, nd.y - cy).where(ok).idxmin()
        self.src = self.idx[(int(nd.x[j]), int(nd.y[j]))]
        xy = np.array(self.nodes, float)
        self.dist_c = np.hypot(xy[:, 0] - cx, xy[:, 1] - cy)
        u, v, ln, rk = [], [], [], []
        for a, b, d in G.edges(data=True):
            u.append(self.idx[a]); v.append(self.idx[b]); ln.append(d["length"]); rk.append(d["rank"])
        self.u, self.v, self.len, self.rank = map(np.array, (u, v, ln, rk))
        self.n = len(self.nodes)
        self.eid = {(a, b): k for k, (a, b) in enumerate(zip(self.u, self.v))}
        mid = (self.dist_c[self.u] + self.dist_c[self.v]) / 2
        zone = np.digitize(mid, ZONES_M)
        self.group = np.array([RANKS.index(r) for r in self.rank]) * 4 + zone
        self.n_groups = len(RANKS) * 4
        self.emid = np.c_[(xy[self.u, 0] + xy[self.v, 0]) / 2, (xy[self.u, 1] + xy[self.v, 1]) / 2]

    def base_minutes(self, rush):
        sp = np.array([SPEEDS[r][rush] for r in self.rank])
        return self.len / 1000 / sp * 60

    def undirected_dist(self, sources):
        A = csr_matrix((self.len, (self.u, self.v)), shape=(self.n, self.n))
        return dijkstra(A, directed=False, indices=sources)


def group_names():
    zn = ("0–3", "3–8", "8–15", ">15")
    return [f"ранг{r} {z} км" for r in RANKS for z in zn]


class Slot:
    """Срез: пути Дейкстры (к центру или из центра), время и время по группам вдоль пути."""

    def __init__(self, net, rush, to_center, pt_nodes):
        self.net, self.rush, self.to_center = net, rush, to_center
        self.pt = np.array(pt_nodes)
        self.base = net.base_minutes(rush)

    def run(self, mult):
        net = self.net
        w = self.base * mult
        A = csr_matrix((w, (net.u, net.v)), shape=(net.n, net.n))
        if self.to_center:
            A = A.T.tocsr()
        dist, pred = dijkstra(A, directed=True, indices=net.src, return_predecessors=True)
        T = dist[self.pt]
        G = np.zeros((len(self.pt), net.n_groups))
        for r, p in enumerate(self.pt):
            cur = p
            while cur != net.src and pred[cur] >= 0:
                prv = pred[cur]
                e = net.eid[(cur, prv)] if self.to_center else net.eid[(prv, cur)]
                G[r, net.group[e]] += w[e]
                cur = prv
        return dist, T, G


PW = 1.0  # степень весов подгонки: строки умножаются на Y^-PW (0 — МНК в минутах, 1 — относительная ошибка)


def row_scale(Y):
    s = Y ** (-PW)
    return s / s.mean()


def ols(T, Y):
    X = np.c_[T, np.ones_like(T)]
    sc = row_scale(Y)
    (a, b), *_ = np.linalg.lstsq(X * sc[:, None], Y * sc, rcond=None)
    return a, b


def fit(slot, tr, Y, lam=None, local=None, D=None):
    """tr — индексы обучающих точек. Возвращает модель (a, b, m, l)."""
    net = slot.net
    m = np.ones(net.n_groups)
    l = np.ones(len(net.u))
    _, T, G = slot.run(m[net.group] * l)
    a, b = ols(T[tr], Y[tr])
    if lam is not None:
        for _ in range(N_ITER):
            r = Y[tr] - (a * T[tr] + b)
            X = G[tr]
            act = X.sum(0) > 0
            sc = row_scale(Y[tr])
            Xa = X[:, act] * sc[:, None]
            d = np.linalg.solve(Xa.T @ Xa + lam * np.eye(act.sum()), Xa.T @ (r / a * sc))
            dd = np.zeros(net.n_groups)
            dd[act] = np.clip(d, -DELTA_STEP, DELTA_STEP)
            m = np.clip(m * (1 + dd), M_LO, M_HI)
            _, T, G = slot.run(m[net.group] * l)
            a, b = ols(T[tr], Y[tr])
    if local is not None:
        pred = a * T[tr] + b
        rho = np.clip((Y[tr] - pred) / np.maximum(pred - b, 1.0), -0.5, 0.5)
        dmid = (D[tr][:, net.u] + D[tr][:, net.v]) / 2  # сетевое расстояние до середины ребра
        w = np.exp(-0.5 * (dmid / local) ** 2)
        s = (w * rho[:, None]).sum(0) / (w.sum(0) + LOCAL_K0)
        l = np.clip(1 + s, L_LO, L_HI)
        _, T, G = slot.run(m[net.group] * l)
        a, b = ols(T[tr], Y[tr])
    return a, b, m, l, T


def predict(model, slot):
    a, b, m, l, _ = model
    _, T, _ = slot.run(m[slot.net.group] * l)
    return a * T + b


def metrics(y, p):
    e = p - y
    sh = y <= 12
    return dict(rmse=float(np.sqrt((e ** 2).mean())), mae=float(np.abs(e).mean()), bias=float(e.mean()),
                rel=float(np.sqrt(((e / y) ** 2).mean())), short_bias=float(e[sh].mean()) if sh.any() else float("nan"))


def loo(slot, tr, Y, **kw):
    pr = []
    for i in tr:
        sub = tr[tr != i]
        model = fit(slot, sub, Y, **kw)
        pr.append(predict(model, slot)[i])
    return np.array(pr)


def run(path, times_csv, points_csv, out_dir):
    from pathlib import Path
    out = Path(out_dir)
    net = Net(path)
    pts = pd.read_csv(points_csv).set_index("point_id")
    tt = pd.read_csv(times_csv)
    pt_nodes = [net.idx[(int(x), int(y))] for x, y in zip(pts.x_utm, pts.y_utm)]
    D = net.undirected_dist(pt_nodes)
    hold = pts["holdout"].to_numpy()
    rows, resid, models = [], [], {}
    for name, (rush, to_c) in SLOTS.items():
        slot = Slot(net, rush, to_c, pt_nodes)
        Y = tt[(tt.slot == name) & (tt.status == "ok")].set_index("point_id").minutes.reindex(pts.index).to_numpy(float)
        valid = ~np.isnan(Y)
        tr, te = np.flatnonzero(~hold & valid), np.flatnonzero(hold & valid)
        variants = {"глобальная": dict()}
        # выбор λ групповой поправки по LOO на обучающих точках
        best_lam, best = None, None
        for lam in LAMBDAS:
            e = metrics(Y[tr], loo(slot, tr, Y, lam=lam))["rmse"]
            if best is None or e < best:
                best_lam, best = lam, e
        variants["групповая"] = dict(lam=best_lam)
        variants["групповая+локальная"] = dict(lam=best_lam, local=LOCAL_SIGMA_M, D=D)
        res = {}
        for vname, kw in variants.items():
            model = fit(slot, tr, Y, **kw)
            res[vname] = dict(model=model, **{f"train_{k}": v for k, v in metrics(Y[tr], predict(model, slot)[tr]).items()},
                              **{f"loo_{k}": v for k, v in metrics(Y[tr], loo(slot, tr, Y, **kw)).items()},
                              **{f"hold_{k}": v for k, v in metrics(Y[te], predict(model, slot)[te]).items()})
        # принятие: каждая следующая поправка — только если LOO-RMSE стал меньше
        chosen = "глобальная"
        for v in ("групповая", "групповая+локальная"):
            if res[v]["loo_rmse"] < res[chosen]["loo_rmse"]:
                chosen = v
        for vname, r in res.items():
            a, b = r["model"][0], r["model"][1]
            rows.append(dict(slot=name, variant=vname, chosen=vname == chosen, a=a, b_min=b,
                             lam=variants[vname].get("lam"), **{k: v for k, v in r.items() if k != "model"}))
        # итоговая модель выбранного варианта — по всем 100 точкам (для изохрон)
        allp = np.flatnonzero(valid)
        kw = dict(variants[chosen])
        final = fit(slot, allp, Y, **kw)
        models[name] = (slot, final, chosen)
        pg = predict(res["глобальная"]["model"], slot)
        pc = predict(res[chosen]["model"], slot)
        for k, pid in enumerate(pts.index):
            resid.append(dict(point_id=pid, label=pts.label[pid], slot=name, holdout=bool(hold[k]), yandex_min=Y[k],
                              global_min=pg[k], chosen_min=pc[k], err_global=pg[k] - Y[k], err_chosen=pc[k] - Y[k]))
        gm = res[chosen]["model"][2]
        pd.DataFrame({"группа": group_names(), "m": gm}).to_csv(out / f"groups_{name.replace(':', '')}.csv", index=False)
    cal = pd.DataFrame(rows)
    cal.to_csv(out / "calibration_uds.csv", index=False)
    pd.DataFrame(resid).to_csv(out / "residuals_uds.csv", index=False)
    return net, models, cal


def draw_isochrones(net, models, out_png):
    from . import isochrones
    from .field import Grid
    from .uds_iso import surface
    import numpy as np
    cx = net.nodes[net.src][0] - 0.0
    cy = net.nodes[net.src][1] - 0.0
    grid = Grid(cx, cy)
    fields, titles = [], []
    for name, (slot, model, chosen) in models.items():
        a, b, m, l, _ = model
        dist, _, _ = slot.run(m[net.group] * l)
        times = {net.nodes[i]: dist[i] for i in range(net.n) if np.isfinite(dist[i])}
        f = surface(grid, None, times)
        fields.append(a * f + b)
        way = "в центр" if slot.to_center else "из центра"
        titles.append(f"{name} ({way}), {chosen}, a={a:.2f}, b={b:.1f} мин")
    isochrones.draw(grid, fields, titles, out_png, "Ярославль",
                    suptitle="Ярославль: изохроны на автомобиле 15/30/45/60 мин по графу УДС, калибровка по Яндекс Картам (20.10.2026)")


def edge_map(net, models, out_dir):
    """Эффективная скорость рёбер по срезам и замедление «пик/свободный поток» (карта и gpkg).
    Время ребра = a·(базовое время·m_группы·l_локальный): масштаб `a` калибровки включён, сдвиг `b` — нет,
    поэтому скорость — оценка «чистого движения» по ребру. Оценка по районам и классам, не замер на сегменте."""
    import geopandas as gpd
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.collections import LineCollection
    from shapely.geometry import LineString

    km = net.len / 1000
    eff = {}
    for name, (slot, (a, b, m, l, _), chosen) in models.items():
        t_h = a * slot.base * m[net.group] * l / 60
        eff[name] = km / t_h  # км/ч
    vmax = np.array([{1: 30, 3: 60, 4: 70, 5: 80, 6: 90}[r] for r in net.rank], float)  # предел класса, км/ч
    n_raw = {k: int((v > vmax).sum()) for k, v in eff.items()}
    eff = {k: np.minimum(v, vmax) for k, v in eff.items()}
    n_inv = int((eff["08:00"] > eff["11:00"]).sum())
    eff["08:00"] = np.minimum(eff["08:00"], eff["11:00"])  # пик не быстрее свободного потока
    print("рёбер выше предела класса:", n_raw, "; утро быстрее дня:", n_inv, "из", len(net.u))
    sp08, sp11, sp18 = eff["08:00"], eff["11:00"], eff["18:00"]
    ratio = sp11 / sp08  # во сколько раз утром в центр медленнее, чем днём
    xy = np.array(net.nodes, float)
    # одно ребро на пару узлов (прямое и обратное усредняем)
    key = np.minimum(net.u, net.v) * net.n + np.maximum(net.u, net.v)
    df = pd.DataFrame(dict(key=key, u=net.u, v=net.v, rank=net.rank, group=net.group, len_m=net.len,
                           speed_0800=sp08, speed_1100=sp11, speed_1800=sp18, slowdown_0800_vs_1100=ratio))
    agg = df.groupby("key").agg(u=("u", "first"), v=("v", "first"), rank=("rank", "first"), group=("group", "first"),
                                len_m=("len_m", "mean"), speed_0800=("speed_0800", "mean"), speed_1100=("speed_1100", "mean"),
                                speed_1800=("speed_1800", "mean"), slowdown_0800_vs_1100=("slowdown_0800_vs_1100", "mean")).reset_index(drop=True)
    names = group_names()
    agg["group_name"] = [names[g] for g in agg["group"]]
    geom = [LineString([xy[u], xy[v]]) for u, v in zip(agg.u, agg.v)]
    gdf = gpd.GeoDataFrame(agg.drop(columns=["u", "v"]), geometry=geom, crs=32637).to_crs(4326)
    gdf.to_file(f"{out_dir}/edges_speed_uds.gpkg", layer="edges", driver="GPKG")

    segs = np.array([[xy[u] / 1000, xy[v] / 1000] for u, v in zip(agg.u, agg.v)])
    panels = [("08:00 в центр, км/ч", "speed_0800", "RdYlGn", 10, 45), ("11:00 в центр, км/ч", "speed_1100", "RdYlGn", 10, 45),
              ("18:00 из центра, км/ч", "speed_1800", "RdYlGn", 10, 45),
              ("замедление 08:00 к 11:00, ×", "slowdown_0800_vs_1100", "YlOrRd", 1.0, 2.0)]
    fig, axes = plt.subplots(2, 2, figsize=(13, 14), constrained_layout=True)
    cx, cy = xy[net.src] / 1000
    for ax, (title, col, cmap, lo, hi) in zip(axes.ravel(), panels):
        order = np.argsort(agg[col].to_numpy()) if col != "slowdown_0800_vs_1100" else np.argsort(agg[col].to_numpy())
        if col != "slowdown_0800_vs_1100":
            order = order[::-1]  # медленные рисуем сверху
        major = agg["rank"].to_numpy() >= 3
        for sel, lw, alpha in ((~major, 0.3, 0.25), (major, 1.1, 1.0)):
            idx = [i for i in order if sel[i]]
            lc = LineCollection(segs[idx], array=agg[col].to_numpy()[idx], cmap=cmap, linewidths=lw, alpha=alpha)
            lc.set_clim(lo, hi)
            ax.add_collection(lc)
        ax.plot(cx, cy, "s", color="black", ms=5)
        ax.set_xlim(cx - 22, cx + 22); ax.set_ylim(cy - 22, cy + 22)
        ax.set_aspect("equal"); ax.set_title(title); ax.tick_params(labelsize=8)
        fig.colorbar(lc, ax=ax, shrink=0.6)
    fig.suptitle("Ярославль: эффективная скорость УДС по калибровке Яндекса (оценка по классу, зоне и району; ограничена пределом класса, 140 точек)", fontsize=12)
    fig.savefig(f"{out_dir}/edges_speed_uds.png", dpi=150)
    plt.close(fig)
    return gdf


def out_of_sample(path, points_csv, times_csv, n_old, cal_csv):
    """Модель, подогнанная по первым n_old точкам (выбранный вариант каждого среза), проверяется на остальных."""
    net = Net(path)
    pts = pd.read_csv(points_csv).set_index("point_id")
    tt = pd.read_csv(times_csv)
    pt_nodes = [net.idx[(int(x), int(y))] for x, y in zip(pts.x_utm, pts.y_utm)]
    D = net.undirected_dist(pt_nodes)
    cal = pd.read_csv(cal_csv)
    rows = []
    for name, (rush, to_c) in SLOTS.items():
        slot = Slot(net, rush, to_c, pt_nodes)
        Y = tt[(tt.slot == name) & (tt.status == "ok")].set_index("point_id").minutes.reindex(pts.index).to_numpy(float)
        tr = np.array([i for i in range(n_old) if not np.isnan(Y[i])])
        te = np.array([i for i in range(n_old, len(pts)) if not np.isnan(Y[i])])
        sub = cal[(cal.slot == name)]
        lam = float(sub[sub.chosen].lam.iloc[0]) if sub[sub.chosen].lam.notna().any() else None
        for vname, kw in (("глобальная", dict()), ("групповая", dict(lam=lam)), ("групповая+локальная", dict(lam=lam, local=LOCAL_SIGMA_M, D=D))):
            model = fit(slot, tr, Y, **kw)
            pr = predict(model, slot)
            rows.append(dict(slot=name, variant=vname, n_new=len(te), **metrics(Y[te], pr[te]), a=model[0], b=model[1]))
    return pd.DataFrame(rows)


def edge_minutes_map(net, models, points_csv, out_png, out_gpkg, max_gap_km=3.0):
    """Абсолютное время по Яндексу (мин) для каждого ребра: a·T_узла + b по калиброванной модели выбранного варианта.
    08:00 и 11:00 — до центра, 18:00 — из центра. Рёбра дальше max_gap_km по сети от замеров не закрашиваются."""
    import geopandas as gpd
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.collections import LineCollection
    from shapely.geometry import LineString

    pts = pd.read_csv(points_csv)
    nodes = np.array([net.idx[(int(x), int(y))] for x, y in zip(pts.x_utm, pts.y_utm)])
    gap = (net.undirected_dist(nodes) / 1000).min(0)
    xy = np.array(net.nodes, float)
    u, v = net.u, net.v
    key = np.minimum(u, v) * net.n + np.maximum(u, v)
    cols = {}
    for name, (slot, (a, b, m, l, _), chosen) in models.items():
        dist, _, _ = slot.run(m[net.group] * l)
        node_min = a * dist + b
        cols[name] = (node_min[u] + node_min[v]) / 2
    df = pd.DataFrame(dict(key=key, u=u, v=v, rank=net.rank, gap_km=np.maximum(gap[u], gap[v]),
                           t_0800=cols["08:00"], t_1100=cols["11:00"], t_1800=cols["18:00"]))
    e = df.groupby("key").first().reset_index(drop=True)
    far = e.gap_km > max_gap_km
    for c in ("t_0800", "t_1100", "t_1800"):
        e.loc[far, c] = np.nan
    gdf = gpd.GeoDataFrame(e.drop(columns=["u", "v"]), geometry=[LineString([xy[a], xy[b]]) for a, b in zip(e.u, e.v)], crs=32637).to_crs(4326)
    gdf.to_file(out_gpkg, layer="edges", driver="GPKG")

    segs = np.array([[xy[a] / 1000, xy[b] / 1000] for a, b in zip(e.u, e.v)])
    cx, cy = xy[net.src] / 1000
    fig, axes = plt.subplots(1, 3, figsize=(21, 7.5), constrained_layout=True)
    for ax, col, title in zip(axes, ("t_0800", "t_1100", "t_1800"),
                              ("08:00, из точки в центр, мин", "11:00, из точки в центр, мин", "18:00, из центра в точку, мин")):
        vals = e[col].to_numpy()
        has = ~np.isnan(vals)
        major = e["rank"].to_numpy() >= 3
        ax.add_collection(LineCollection(segs[~has], colors="#d9d9d9", linewidths=0.3))
        for sel, lw, al in ((has & ~major, 0.5, 0.45), (has & major, 1.5, 1.0)):
            idx = np.flatnonzero(sel)
            idx = idx[np.argsort(vals[idx])]
            lc = LineCollection(segs[idx], array=vals[idx], cmap="viridis_r", linewidths=lw, alpha=al)
            lc.set_clim(0, 50)
            ax.add_collection(lc)
        ax.plot(cx, cy, "s", color="red", ms=7, zorder=6)
        ax.set_xlim(cx - 21, cx + 21); ax.set_ylim(cy - 21, cy + 21)
        ax.set_aspect("equal"); ax.set_title(title)
        fig.colorbar(lc, ax=ax, shrink=0.7)
    fig.suptitle(f"Ярославль: время в пути по Яндекс Картам до/из Богоявленской площади (калиброванная модель УДС, {len(pts)} точек замеров; серое — дальше {max_gap_km:g} км от замеров)", fontsize=11)
    fig.savefig(out_png, dpi=140)
    plt.close(fig)
    return e


def draw_isochrones_v2(net, models, points_csv, out_png, cover_km=5.0):
    """Изохроны 15/30/45/60 по калиброванной модели. Серым закрыта зона дальше cover_km от замеров,
    60 мин (больше самого долгого замера, 47) — пунктиром, как экстраполяция."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from scipy.spatial import cKDTree
    from . import isochrones
    from .field import Grid
    from .uds_iso import surface

    pts = pd.read_csv(points_csv)
    cx, cy = net.nodes[net.src]
    grid = Grid(cx, cy)
    X, Y = grid.centers()
    d_pt = cKDTree(np.c_[pts.x_utm, pts.y_utm]).query(np.c_[X.ravel(), Y.ravel()])[0].reshape(X.shape) / 1000
    uncovered = d_pt > cover_km
    fig, axes = plt.subplots(1, 3, figsize=(21, 7.5), constrained_layout=True)
    ext = [grid.xs[0] / 1000, grid.xs[-1] / 1000, grid.ys[0] / 1000, grid.ys[-1] / 1000]
    shades = {15: "#9ecae1", 30: "#4292c6", 45: "#08519c", 60: "#08306b"}
    for ax, (name, (slot, model, chosen)) in zip(axes, models.items()):
        a, b, m, l, _ = model
        dist, _, _ = slot.run(m[net.group] * l)
        f = a * surface(grid, None, {net.nodes[i]: dist[i] for i in range(net.n) if np.isfinite(dist[i])}) + b
        ax.imshow(np.where(uncovered, 1.0, np.nan), extent=ext, origin="lower", cmap="Greys", vmin=0, vmax=3, alpha=0.35, zorder=0)
        for level, color in shades.items():
            for ln in isochrones.isochrone_lines(grid, f, level):
                ax.plot(ln[:, 0] / 1000, ln[:, 1] / 1000, color=color, lw=1.8, ls="--" if level == 60 else "-", zorder=2)
            lines = isochrones.isochrone_lines(grid, f, level)
            if lines:
                top = max((ln[np.argmax(ln[:, 1])] for ln in lines), key=lambda q: q[1])
                ax.annotate(f"{level} мин", (top[0] / 1000, top[1] / 1000), xytext=(0, 4), textcoords="offset points",
                            ha="center", fontsize=9, color=color)
        ax.plot(pts.x_utm / 1000, pts.y_utm / 1000, ".", color="k", ms=3, zorder=3)
        ax.plot(cx / 1000, cy / 1000, "s", color="red", ms=7, zorder=4)
        way = "в центр" if slot.to_center else "из центра"
        ax.set_xlim(cx / 1000 - 28, cx / 1000 + 28); ax.set_ylim(cy / 1000 - 28, cy / 1000 + 28)
        ax.set_aspect("equal"); ax.set_title(f"{name} ({way})")
    fig.suptitle("Ярославль: изохроны на автомобиле 15/30/45/60 мин по Яндекс Картам, 20.10.2026 (калиброванная модель УДС; серое — вне зоны замеров, 60 мин — экстраполяция)", fontsize=11)
    fig.savefig(out_png, dpi=140)
    fig.savefig(str(out_png).rsplit(".", 1)[0] + ".pdf")
    plt.close(fig)


def draw_isochrones_v3(net, models, points_csv, out_png, levels=(10, 20, 30, 45), cover_km=5.0):
    """Заливка зон доступности: 0–10, 10–20, 20–30, 30–45 мин и «45+» (дальше последнего уровня).
    Серым закрыта зона дальше cover_km от замеров."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Patch
    from scipy.spatial import cKDTree
    from .field import Grid
    from .uds_iso import surface

    pts = pd.read_csv(points_csv)
    cx, cy = net.nodes[net.src]
    grid = Grid(cx, cy)
    X, Y = grid.centers()
    d_pt = cKDTree(np.c_[pts.x_utm, pts.y_utm]).query(np.c_[X.ravel(), Y.ravel()])[0].reshape(X.shape) / 1000
    d_road = cKDTree(np.array(net.nodes, float)).query(np.c_[X.ravel(), Y.ravel()])[0].reshape(X.shape) / 1000
    uncovered = (d_pt > cover_km) | (d_road > 1.5)  # нет замеров рядом или нет дорог слоя
    edges = [-1.0, *levels, 1e4]
    colors = ["#ffffb2", "#a1dab4", "#41b6c4", "#2c7fb8", "#253494"][: len(edges) - 1]
    names = [f"до {levels[0]} мин"] + [f"{a}–{b} мин" for a, b in zip(levels[:-1], levels[1:])] + [f"{levels[-1]}+ мин"]
    fig, axes = plt.subplots(1, 3, figsize=(21, 8), constrained_layout=True)
    ext = [grid.xs[0] / 1000, grid.xs[-1] / 1000, grid.ys[0] / 1000, grid.ys[-1] / 1000]
    for ax, (name, (slot, model, chosen)) in zip(axes, models.items()):
        a, b, m, l, _ = model
        dist, _, _ = slot.run(m[net.group] * l)
        f = a * surface(grid, None, {net.nodes[i]: dist[i] for i in range(net.n) if np.isfinite(dist[i])}) + b
        f = np.where(uncovered, np.nan, f)
        ax.contourf(grid.xs / 1000, grid.ys / 1000, np.ma.masked_invalid(f), levels=edges, colors=colors, zorder=1)
        ax.contour(grid.xs / 1000, grid.ys / 1000, np.ma.masked_invalid(f), levels=list(levels), colors="k", linewidths=0.6, zorder=2)
        ax.imshow(np.where(uncovered, 1.0, np.nan), extent=ext, origin="lower", cmap="Greys", vmin=0, vmax=3, alpha=0.3, zorder=0)
        ax.plot(pts.x_utm / 1000, pts.y_utm / 1000, ".", color="k", ms=2.5, zorder=3)
        ax.plot(cx / 1000, cy / 1000, "s", color="red", ms=7, zorder=4)
        way = "в центр" if slot.to_center else "из центра"
        ax.set_xlim(cx / 1000 - 26, cx / 1000 + 26); ax.set_ylim(cy / 1000 - 26, cy / 1000 + 26)
        ax.set_aspect("equal"); ax.set_title(f"{name} ({way})")
        ax.legend(handles=[Patch(color=c, label=n) for c, n in zip(colors, names)], loc="lower left", fontsize=9, title="время в пути")
    fig.suptitle("Ярославль: зоны доступности на автомобиле по Яндекс Картам, 20.10.2026 (калиброванная модель УДС; серое — вне зоны замеров или без дорог в слое)", fontsize=11)
    fig.savefig(out_png, dpi=140)
    fig.savefig(str(out_png).rsplit(".", 1)[0] + ".pdf")
    plt.close(fig)


def export_polygons(net, models, points_csv, out_gpkg, levels=(10, 20, 30, 45), cover_km=5.0, simplify_m=60.0):
    """Полигональный слой изохрон (EPSG:4326, GeoPackage).
    Слой `isochrones`: вложенные изохроны ≤10/20/30/45 мин — компонента с центром, внутренние кольца заполнены, контур
    упрощён (как в методе). Слой `bands`: кольцевые зоны 0–10, 10–20, 20–30, 30–45, 45+ (все фрагменты в зоне замеров)."""
    import contourpy
    import geopandas as gpd
    from scipy.ndimage import binary_fill_holes, gaussian_filter, label
    from scipy.spatial import cKDTree
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    from .field import Grid
    from .uds_iso import surface

    pts = pd.read_csv(points_csv)
    cx, cy = net.nodes[net.src]
    grid = Grid(cx, cy)
    X, Y = grid.centers()
    q = np.c_[X.ravel(), Y.ravel()]
    d_pt = cKDTree(np.c_[pts.x_utm, pts.y_utm]).query(q)[0].reshape(X.shape) / 1000
    d_road = cKDTree(np.array(net.nodes, float)).query(q)[0].reshape(X.shape) / 1000
    uncovered = (d_pt > cover_km) | (d_road > 1.5)
    ci, cj = int((cy - grid.y0) // grid.cell), int((cx - grid.x0) // grid.cell)

    def polys_from_filled(f, lo, hi):
        gen = contourpy.contour_generator(grid.xs, grid.ys, np.ma.masked_invalid(f), fill_type=contourpy.FillType.OuterOffset)
        pts_l, offs_l = gen.filled(lo, hi)
        out = []
        for p, o in zip(pts_l, offs_l):
            rings = [p[o[i]:o[i + 1]] for i in range(len(o) - 1)]
            if len(rings[0]) >= 4:
                out.append(Polygon(rings[0], [r for r in rings[1:] if len(r) >= 4]))
        return out

    iso_rows, band_rows = [], []
    names = [f"0–{levels[0]}"] + [f"{a}–{b}" for a, b in zip(levels[:-1], levels[1:])] + [f"{levels[-1]}+"]
    bounds = [-1.0, *levels, 1e4]
    for name, (slot, model, chosen) in models.items():
        a, b, m, l, _ = model
        dist, _, _ = slot.run(m[net.group] * l)
        f = a * surface(grid, None, {net.nodes[i]: dist[i] for i in range(net.n) if np.isfinite(dist[i])}) + b
        f = np.where(uncovered, np.nan, f)
        way = "to_center" if slot.to_center else "from_center"
        prev = None
        for lev in levels:
            mask = np.nan_to_num(f, nan=1e9) <= lev
            lab, _n = label(mask)
            if lab[ci, cj] > 0:
                comp = lab == lab[ci, cj]
            elif _n > 0:  # центр сам не в зоне (утром 10 мин — со сдвигом от центра): берём крупнейшую компоненту
                comp = lab == (1 + int(np.argmax(np.bincount(lab.ravel())[1:])))
            else:
                comp = np.zeros_like(mask)
            comp = binary_fill_holes(comp)
            sm = gaussian_filter(comp.astype(float), 1.0)
            ps = polys_from_filled(np.where(np.ones_like(sm, bool), sm, np.nan), 0.5, 2.0)
            geom = unary_union(ps).simplify(simplify_m)
            if prev is not None:
                geom = unary_union([geom, prev])
            prev = geom
            iso_rows.append(dict(slot=name, direction=way, level_min=lev, kind="isochrone", area_km2=geom.area / 1e6, geometry=geom))
        for nm, lo, hi in zip(names, bounds[:-1], bounds[1:]):
            ps = polys_from_filled(f, lo, hi)
            if not ps:
                continue
            geom = unary_union(ps).simplify(simplify_m)
            band_rows.append(dict(slot=name, direction=way, band=nm, upper_min=hi if hi < 1e3 else None, area_km2=geom.area / 1e6, geometry=geom))
    iso = gpd.GeoDataFrame(iso_rows, crs=32637).to_crs(4326)
    bands = gpd.GeoDataFrame(band_rows, crs=32637).to_crs(4326)
    iso.to_file(out_gpkg, layer="isochrones", driver="GPKG")
    bands.to_file(out_gpkg, layer="bands", driver="GPKG")
    return iso, bands
