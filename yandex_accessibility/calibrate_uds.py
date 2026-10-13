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


def ols(T, Y):
    X = np.c_[T, np.ones_like(T)]
    (a, b), *_ = np.linalg.lstsq(X, Y, rcond=None)
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
            Xa = X[:, act]
            d = np.linalg.solve(Xa.T @ Xa + lam * np.eye(act.sum()), Xa.T @ (r / a))
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
    return dict(rmse=float(np.sqrt((e ** 2).mean())), mae=float(np.abs(e).mean()), bias=float(e.mean()))


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
    tr, te = np.flatnonzero(~hold), np.flatnonzero(hold)
    rows, resid, models = [], [], {}
    for name, (rush, to_c) in SLOTS.items():
        slot = Slot(net, rush, to_c, pt_nodes)
        Y = tt[tt.slot == name].set_index("point_id").minutes.reindex(pts.index).to_numpy(float)
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
        allp = np.arange(len(pts))
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
