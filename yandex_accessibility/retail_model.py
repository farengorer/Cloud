"""Покупательские поездки в модели спроса: выручка ячеек H3 как притяжение (вечер 17–20)."""
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree
from scipy.stats import spearmanr

from . import demand_model as dm
from . import revenue as rv
from .calibrate_uds import Net

THETA_AM = 0.1187


class Setup:
    def __init__(self, uds, taz, hexgpkg, points_csv, times_csv):
        self.net = net = Net(uds)
        self.cap = dm.edge_capacity(net, uds)
        Z = dm.Zones(taz, net)
        self.g = g = Z.g[Z.g.snap_km < 3].reset_index(drop=True)
        self.nodes = g.node.to_numpy()
        self.t0 = net.base_minutes(0)
        self.T0 = dm.free_skim(net, self.nodes, self.t0)
        self.pop = g["Население_сущ"].to_numpy(float)
        self.jobs = g["МПТ_сущ"].to_numpy(float)
        D = self.jobs / self.jobs.sum() * self.pop.sum()
        self.od_c = dm.gravity(self.T0, self.pop, D, 0.08)
        hx = rv.load_hex(hexgpkg)
        c = hx.geometry.centroid
        d, i = cKDTree(np.array(net.nodes, float)).query(np.c_[c.x, c.y])
        ok = d < 500
        hx = hx[ok].copy()
        hx["node"] = i[ok]
        share = hx["hours"].map(lambda h: h[17:20].sum() / np.nansum(h) if np.isfinite(h).all() and np.nansum(h) > 0 else np.nan)
        hx["share_eve"] = share.fillna(share.mean())
        hx["att_eve"] = hx["receipts"] * hx["share_eve"]
        hx["att_day"] = hx["receipts"]
        self.hx = hx
        agg = hx.groupby("node").agg(att_eve=("att_eve", "sum"), att_day=("att_day", "sum"), rev=("rev", "sum"))
        self.hnodes = agg.index.to_numpy()
        self.att_eve = agg["att_eve"].to_numpy()
        self.att_day = agg["att_day"].to_numpy()
        self.Tzh = dm.free_skim_rect(net, self.nodes, self.hnodes, self.t0)
        pts = pd.read_csv(points_csv).set_index("point_id")
        tt = pd.read_csv(times_csv)
        tt = tt[tt.status == "ok"].pivot(index="point_id", columns="slot", values="minutes").reindex(pts.index)
        pts = pts[tt["18:00"].notna() & tt["11:00"].notna()]
        self.tt = tt.loc[pts.index]
        self.pn = np.array([net.idx[(int(x), int(y))] for x, y in zip(pts.x_utm, pts.y_utm)])
        self.obs_ratio = (self.tt["18:00"] / self.tt["11:00"]).to_numpy()
        self.obs_exc = (self.tt["18:00"] - self.tt["11:00"]).to_numpy()

    def sssp_out(self, t):
        A = csr_matrix((t, (self.net.u, self.net.v)), shape=(self.net.n, self.net.n))
        return dijkstra(A, directed=True, indices=self.net.src)

    def evening_od(self, alpha, nu, shop="home", lam_s=0.15, att=None):
        """Матрица вечернего спроса: возврат с работы (alpha·od_c.T) + покупки (nu·объём работы) в ячейки H3."""
        att = self.att_eve if att is None else att
        cols = [alpha * self.od_c.T]
        if nu > 0:
            origin = self.pop if shop == "home" else self.jobs
            Ds = att / att.sum() * origin.sum()
            ods = dm.gravity(self.Tzh, origin, Ds, lam_s)
            cols.append(nu * ods)
        else:
            cols.append(np.zeros((len(self.nodes), len(self.hnodes))))
        return np.hstack(cols), np.concatenate([self.nodes, self.hnodes])

    def evaluate(self, od, dn, phi, iters=6):
        f, t = dm.assign(self.net, od, self.nodes, self.t0, self.cap, phi, iters, dnodes=dn)
        a, b = dm.IMP_A, dm.IMP_B
        fr = self.sssp_out(self.t0)[self.pn]
        tp = self.sssp_out(t)[self.pn]
        ratio = (a * tp + b) / (a * fr + b)
        return ratio, a * (tp - fr), f

    def calibrate(self, od, dn, lo=0.002, hi=0.4, steps=8):
        target = self.obs_ratio.mean()
        for _ in range(steps):
            mid = (lo * hi) ** 0.5
            r, _, _ = self.evaluate(od, dn, mid, 4)
            if r.mean() < target:
                lo = mid
            else:
                hi = mid
        return (lo * hi) ** 0.5


def road_exposure(S, theta=THETA_AM, iters=8):
    """Выручка×задержка по рёбрам: по дереву кратчайших путей к центру (утро, равновесные времена базы).
    Для каждого ребра: W — выручка ячеек (в утреннем окне 7–10), чей путь к центру проходит по ребру, млн ₽/нед;
    delay — задержка на ребре (шкала Яндекса, мин); exposure = W × delay, млн ₽·мин."""
    net = S.net
    f, t = dm.assign(net, S.od_c, S.nodes, S.t0, S.cap, theta, iters)
    A = csr_matrix((t, (net.u, net.v)), shape=(net.n, net.n)).T.tocsr()
    dist, pred = dijkstra(A, directed=True, indices=net.src, return_predecessors=True)
    hx = S.hx[S.hx["rev"].notna()].copy()
    H = np.vstack(hx["hours"].to_list())
    sh_am = np.nan_to_num(H[:, 7:10].sum(1) / np.nansum(H, 1))
    w = np.zeros(net.n)
    np.add.at(w, hx["node"].to_numpy(), hx["rev"].to_numpy() * sh_am / 1e6)
    acc = w.copy()
    delay = np.zeros(len(net.u))
    W = np.zeros(len(net.u))
    order = np.argsort(-np.where(np.isfinite(dist), dist, -1))
    for i in order:
        p = pred[i]
        if p >= 0 and np.isfinite(dist[i]):
            e = net.eid[(i, p)]
            delay[e] = (t[e] - S.t0[e]) * dm.IMP_A
            W[e] = acc[i]
            acc[p] += acc[i]
    return dict(flow=f, t=t, W=W, delay=delay, exposure=W * delay)
