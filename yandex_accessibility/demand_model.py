"""Упрощённая модель спроса и загрузки сети поверх калиброванной УДС.

Шаги: транспортные районы (население, МПТ) → матрица корреспонденций (двухсторонне ограниченная гравитационная,
импеданс — свободное время сети) → равновесное распределение по сети (MSA, функция BPR) → время пик/свободное.
Масштаб спроса подбирается так, чтобы средняя «утро/день» по замерам Яндекса совпала с модельной; после этого
пространственная картина проверяется по замерам независимо."""
import geopandas as gpd
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

from .calibrate_uds import Net
from .uds_iso import SPEEDS

CAP_LANE = {1: 600.0, 3: 900.0, 4: 1200.0, 5: 1500.0, 6: 1800.0}  # авт/ч на полосу (городские улицы со светофорами)
LANES_DEFAULT = {1: 1, 3: 1, 4: 2, 5: 2, 6: 2}  # полос на направление, если в слое не указано
ZONE_MO = ("Ярославль", "Ярославский муниципальный округ")
BPR_A, BPR_B = 0.15, 4.0
IMP_A, IMP_B = 0.90, 4.0  # импеданс в минутах: a·T_сети + b (глобальная калибровка 11:00)
MEAN_TRIP_MIN = 24.0  # допущение: средняя длина поездки на работу, мин (подбирает λ гравитации)


def edge_capacity(net, path):
    gdf = gpd.read_file(path).to_crs(32637)
    key = lambda p: (round(p[0]), round(p[1]))
    lanes = {}
    for r in gdf.itertuples():
        txt = str(r.lanes).split(";")[0].split("-")[0].strip()
        n = int(txt) if txt.isdigit() else None
        for ls in r.geometry.geoms:
            c = list(ls.coords)
            a, b = net.idx.get(key(c[0])), net.idx.get(key(c[-1]))
            if a is not None and b is not None:
                lanes[(a, b)] = n
                lanes[(b, a)] = n
    cap = np.empty(len(net.u))
    for e, (a, b) in enumerate(zip(net.u, net.v)):
        n = lanes.get((int(a), int(b)))
        rank = int(net.rank[e])
        if n is None:
            per_dir = LANES_DEFAULT[rank]
        else:
            per_dir = n if (int(b), int(a)) not in net.eid else max(1, n // 2)
        cap[e] = per_dir * CAP_LANE[rank]
    return cap


class Zones:
    def __init__(self, taz_path, net):
        g = gpd.read_file(taz_path).to_crs(32637)
        g = g[g["МО"].isin(ZONE_MO)].reset_index(drop=True)
        c = g.geometry.representative_point()
        xy = np.array(net.nodes, float)
        d, i = cKDTree(xy).query(np.c_[c.x, c.y])
        g["node"] = i
        g["snap_km"] = d / 1000
        self.g = g
        self.net = net


def gravity(Tmin, O, D, lam, iters=40):
    f = np.exp(-lam * (IMP_A * Tmin + IMP_B))
    a = np.ones(len(O)); b = np.ones(len(D))
    for _ in range(iters):
        a = O / np.maximum(f @ b, 1e-12)
        b = D / np.maximum(f.T @ a, 1e-12)
    return a[:, None] * f * b[None]


def free_skim(net, nodes, base):
    A = csr_matrix((base, (net.u, net.v)), shape=(net.n, net.n))
    D = dijkstra(A, directed=True, indices=np.unique(nodes))
    lut = {n: k for k, n in enumerate(np.unique(nodes))}
    return D[[lut[n] for n in nodes]][:, nodes]


def assign(net, od, nodes, t0, cap, theta, iters=8):
    """od — поездки между районами (по строкам: из района i в район j), theta — авт/ч на одну поездку.
    Равновесие методом последовательных средних. Возвращает потоки по рёбрам и итоговое время ребра."""
    n_e = len(net.u)
    flow = np.zeros(n_e)
    un = np.unique(nodes)
    for it in range(iters):
        t = t0 * (1 + BPR_A * (flow / cap) ** BPR_B)
        A = csr_matrix((t, (net.u, net.v)), shape=(net.n, net.n))
        dist, pred = dijkstra(A, directed=True, indices=un, return_predecessors=True)
        new = np.zeros(n_e)
        for k, o in enumerate(un):
            rows = np.flatnonzero(nodes == o)
            dem = np.zeros(net.n)
            np.add.at(dem, nodes, od[rows].sum(0))  # спрос из узла o в каждый узел назначения
            dem[o] = 0
            order = np.argsort(-dist[k])
            pk = pred[k]
            for i in order:
                if dem[i] > 0 and pk[i] >= 0:
                    p = pk[i]
                    new[net.eid[(p, i)]] += dem[i]
                    dem[p] += dem[i]
        new *= theta
        flow = new if it == 0 else flow + (new - flow) / (it + 1)
    t = t0 * (1 + BPR_A * (flow / cap) ** BPR_B)
    return flow, t
