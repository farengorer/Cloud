"""Поле времени в пути до центра на сетке 250 м.

Дороги дают время в узлах и вдоль рёбер; вне дорог время распространяется по сетке с
пешей/бездорожной скоростью (`OFFROAD_KMH`). Воду (если задана) сетка обходит — так
водохранилища и реки не «перепрыгиваются», а мосты работают как дороги."""
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra

from .config import CELL_M, GRID_MARGIN_M, OFFROAD_KMH, ZONE_RADIUS_M, City
from .graph import times_to_center


class Grid:
    def __init__(self, cx, cy, radius=ZONE_RADIUS_M + GRID_MARGIN_M, cell=CELL_M):
        n = int(np.ceil(2 * radius / cell))
        self.cell, self.n, self.x0, self.y0 = cell, n, cx - radius, cy - radius
        self.xs = self.x0 + (np.arange(n) + 0.5) * cell
        self.ys = self.y0 + (np.arange(n) + 0.5) * cell
        self.cx, self.cy = cx, cy

    def index(self, x, y):
        """Индексы (row, col) и флаг попадания в сетку."""
        col = np.floor((np.asarray(x) - self.x0) / self.cell).astype(int)
        row = np.floor((np.asarray(y) - self.y0) / self.cell).astype(int)
        return row, col, (row >= 0) & (row < self.n) & (col >= 0) & (col < self.n)

    def centers(self):
        return np.meshgrid(self.xs, self.ys)  # X[row, col], Y[row, col]


def water_mask(grid: Grid, water_gdf) -> np.ndarray:
    """True в ячейках, центр которых лежит в воде. `water_gdf` — полигоны в CRS сетки."""
    import shapely

    X, Y = grid.centers()
    mask = np.zeros(X.shape, bool)
    for geom in water_gdf.geometry:
        if geom is not None and geom.geom_type in ("Polygon", "MultiPolygon"):
            mask |= shapely.contains_xy(geom, X, Y)
    return mask


def road_samples(G, to_utm, step_m=100.0):
    """Точки вдоль рёбер с временем до центра: узлы + промежуточные точки каждые ~step_m.
    Требует рассчитанного `tt_to_center` на узлах. Возвращает x, y, t (сек)."""
    xs, ys, ts = [], [], []
    for u, v, d in G.edges(data=True):
        tu, tv = G.nodes[u].get("tt_to_center"), G.nodes[v].get("tt_to_center")
        if tv is None:
            continue
        geom = d.get("geometry")
        if geom is not None:
            pts = np.array(geom.coords)  # lon, lat
        else:
            pts = np.array([[G.nodes[u]["x"], G.nodes[u]["y"]], [G.nodes[v]["x"], G.nodes[v]["y"]]])
        px, py = to_utm.transform(pts[:, 0], pts[:, 1])
        seg = np.hypot(np.diff(px), np.diff(py))
        cum = np.r_[0, np.cumsum(seg)]
        total = cum[-1]
        if total == 0:
            continue
        k = max(int(total // step_m), 1)
        s = np.linspace(0, total, k + 1)
        sx, sy = np.interp(s, cum, px), np.interp(s, cum, py)
        # от точки до v по ребру + время v до центра (ребро u→v проходится в этом направлении)
        rest = (total - s) / total * d["tt_sec"]
        xs.append(sx); ys.append(sy); ts.append(tv + rest)
    return np.concatenate(xs), np.concatenate(ys), np.concatenate(ts)


def build_time_field(G, center_node, city: City, scenario, grid: Grid, water=None, offroad_kmh=OFFROAD_KMH):
    """Время до центра, мин, по сетке `grid` (n×n). Ячейки воды без дорог → NaN."""
    from pyproj import Transformer

    from .graph import set_edge_times

    set_edge_times(G, scenario)
    tt = times_to_center(G, center_node)
    for n, t in tt.items():
        G.nodes[n]["tt_to_center"] = t
    to_utm = Transformer.from_crs(4326, city.epsg, always_xy=True)
    sx, sy, st = road_samples(G, to_utm)
    row, col, ok = grid.index(sx, sy)

    n = grid.n
    best = np.full(n * n, np.inf)
    flat = row[ok] * n + col[ok]
    np.minimum.at(best, flat, st[ok])
    road_cells = np.isfinite(best)

    passable = np.ones(n * n, bool)
    if water is not None:
        passable = ~water.ravel()
    passable |= road_cells  # мосты и дороги по воде проходимы

    # граф ячеек: 8 соседей, вес = расстояние / скорость; виртуальный исток → ячейки с дорогой
    v = offroad_kmh / 3.6
    idx = np.arange(n * n).reshape(n, n)
    src, dst, w = [], [], []
    for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
        r0, r1 = 0, n - dr
        c0, c1 = max(0, -dc), n - max(0, dc)
        a = idx[r0:r1, c0:c1].ravel()
        b = idx[r0 + dr:r1 + dr, c0 + dc:c1 + dc].ravel()
        keep = passable[a] & passable[b]
        a, b = a[keep], b[keep]
        c = grid.cell * np.hypot(dr, dc) / v
        src += [a, b]; dst += [b, a]; w += [np.full(a.size * 2, c)]
    virtual = n * n
    roads = np.flatnonzero(road_cells)
    src.append(np.full(roads.size, virtual)); dst.append(roads); w.append(best[roads])
    src, dst, w = np.concatenate(src), np.concatenate(dst), np.concatenate(w)
    A = coo_matrix((w, (src, dst)), shape=(n * n + 1, n * n + 1)).tocsr()
    dist = dijkstra(A, directed=True, indices=virtual)[:-1]
    dist[~np.isfinite(dist)] = np.nan
    dist[~passable] = np.nan
    return (dist / 60.0).reshape(n, n)


def node_times_min(G, nodes):
    return np.array([G.nodes[n]["tt_to_center"] / 60.0 for n in nodes])
