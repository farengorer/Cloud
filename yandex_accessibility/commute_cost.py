"""Потери времени и «потери зарплаты» на поездки дом–работа по модели спроса.

Время поездки в шкале Яндекса: a·T_сети + b (a, b — глобальная калибровка 11:00). «Свободное» — по свободному потоку,
«с пробками» — по равновесным временам рёбер в утренний пик. Стоимость минуты = зарплата / рабочие часы в месяц."""
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

from . import demand_model as dm
from .calibrate_uds import Net
from .forecast import LAM, SCEN

WAGE = 70_000.0
HOURS_PER_MONTH = 164.0  # производственный календарь РФ, в среднем за год
WORKDAYS = 21.0
EVENING_SHARE = 0.3  # вечерняя избыточная задержка к утренней (замеры Яндекса: +2,6 против +8,6 мин)


def skim_from(net, nodes, t):
    A = csr_matrix((t, (net.u, net.v)), shape=(net.n, net.n))
    un = np.unique(nodes)
    D = dijkstra(A, directed=True, indices=un)
    lut = {n: k for k, n in enumerate(un)}
    return D[[lut[n] for n in nodes]][:, nodes]


def run(path, taz, theta, out_dir):
    from pathlib import Path
    out = Path(out_dir)
    net = Net(path)
    cap = dm.edge_capacity(net, path)
    Z = dm.Zones(taz, net)
    g = Z.g[Z.g.snap_km < 3].reset_index(drop=True)
    nodes = g.node.to_numpy()
    t0 = net.base_minutes(0)
    T0 = dm.free_skim(net, nodes, t0)
    city = (g["МО"] == "Ярославль").to_numpy()
    rate = WAGE / HOURS_PER_MONTH / 60.0  # руб/мин
    a, b = dm.IMP_A, dm.IMP_B
    rows, dist = [], []
    for name, (pc, jc) in {"существующее положение": ("Население_сущ", "МПТ_сущ"), **SCEN}.items():
        O = g[pc].fillna(0).to_numpy(float)
        Jb = g[jc].fillna(0).to_numpy(float)
        D = Jb / Jb.sum() * O.sum()
        od = dm.gravity(T0, O, D, LAM)
        flow, t = dm.assign(net, od, nodes, t0, cap, theta, 8)
        Tc = skim_from(net, nodes, t)
        w = od[city].sum()
        free = float((od[city] * (a * T0[city] + b)).sum() / w)
        cong = float((od[city] * (a * Tc[city] + b)).sum() / w)
        exc = cong - free
        day_free = 2 * free
        day_exc = exc * (1 + EVENING_SHARE)
        row = dict(сценарий=name, поездка_свободно_мин=free, поездка_пик_мин=cong, пробки_мин_в_одну_сторону=exc,
                   в_день_всего_мин=day_free + day_exc, в_день_из_них_пробки_мин=day_exc)
        for k in ("в_день_всего_мин", "в_день_из_них_пробки_мин"):
            m = row[k] * WORKDAYS
            row[k.replace("мин", "руб_мес")] = m * rate
            row[k.replace("мин", "часов_мес")] = m / 60
        row["доля_ЗП_всего_%"] = 100 * row["в_день_всего_руб_мес"] / WAGE
        row["доля_ЗП_пробки_%"] = 100 * row["в_день_из_них_пробки_руб_мес"] / WAGE
        rows.append(row)
        if name == "существующее положение":
            for adm, sel in g[city].groupby("Адм_район").groups.items():
                idx = np.array([g.index.get_loc(i) for i in sel])
                ww = od[idx].sum()
                dist.append(dict(район=adm, поездка_свободно_мин=float((od[idx] * (a * T0[idx] + b)).sum() / ww),
                                 поездка_пик_мин=float((od[idx] * (a * Tc[idx] + b)).sum() / ww)))
    res = pd.DataFrame(rows).round(1)
    res.to_csv(out / "commute_cost.csv", index=False)
    dd = pd.DataFrame(dist)
    dd["пробки_мин"] = dd.поездка_пик_мин - dd.поездка_свободно_мин
    dd.round(1).to_csv(out / "commute_cost_by_district.csv", index=False)
    return res, dd.round(1), rate
