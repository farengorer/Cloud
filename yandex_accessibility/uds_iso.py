"""Изохроны по графу УДС (слой gpkg) без калибровки по Яндексу: скорости по классам дорог.

08:00 и 11:00 — время в центр (по обращённому графу); 18:00 — время из центра.
Это «сырое» время сети: сдвиг ~8 мин и масштаб из калибровки не применяются."""
import networkx as nx
import numpy as np
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree

from . import isochrones
from .field import Grid
from .uds import CENTER_NAME, EPSG, center_from_layer, load_network  # noqa: F401

# Скорость по рангу класса, км/ч: (свободный поток, час пик). Допущение, не из данных:
# в слое Speed почти везде 20 и не различает классы.
SPEEDS = {6: (70, 45), 5: (55, 30), 4: (45, 27), 3: (35, 23), 1: (20, 16)}
LAST_MILE_KMH = 15.0
MAX_LAST_MILE_M = 2500.0
SIGMA_M = 1250.0
SLOTS = (("08:00", 1, "в центр"), ("11:00", 0, "в центр"), ("18:00", 1, "из центра"))


def node_times(G, center, rush, reverse=False):
    H = G.reverse(copy=False) if reverse else G
    k = 1 if rush else 0
    w = lambda u, v, d: d["length"] / 1000 / SPEEDS[d["rank"]][k] * 60  # мин
    return nx.single_source_dijkstra_path_length(H, center, weight=w)


def surface(grid, G, times):
    ids = [n for n in times]
    pts = np.array(ids, float)
    t = np.array([times[n] for n in ids])
    X, Y = grid.centers()
    d, i = cKDTree(pts).query(np.c_[X.ravel(), Y.ravel()])
    f = t[i] + d / 1000 / LAST_MILE_KMH * 60
    f[d > MAX_LAST_MILE_M] = 300.0  # дорог рядом нет
    f = f.reshape(X.shape)
    f = gaussian_filter(f, SIGMA_M / grid.cell)
    f[np.hypot(X - grid.cx, Y - grid.cy) > 30000 + 2000] = np.nan
    return f


def main(path, out_png):
    center_ll = center_from_layer(path)
    G, nd, (cx, cy) = load_network(path, center_ll)
    # старт — ближайший перекрёсток без барьера (тупик/шлагбаум у площади искажает всё поле)
    ok = (nd["deg"] >= 3) & ~nd["barrier"]
    j = np.hypot(nd.x - cx, nd.y - cy).where(ok).idxmin()
    start = (int(nd.x[j]), int(nd.y[j]))
    print(f"старт изохрон: сдвиг от центра {np.hypot(nd.x[j] - cx, nd.y[j] - cy):.0f} м")
    grid = Grid(cx, cy)
    fields, titles = [], []
    for slot, rush, direction in SLOTS:
        t = node_times(G, start, bool(rush), reverse=direction == "в центр")
        fields.append(surface(grid, G, t))
        titles.append(f"{slot} ({direction}, {'час пик' if rush else 'свободный поток'})")
    isochrones.draw(grid, fields, titles, out_png, "Ярославль",
                    suptitle="Ярославль: изохроны на автомобиле 15/30/45/60 мин по графу УДС (без калибровки по Яндексу)")
    return grid, fields
