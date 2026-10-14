"""Интерполяция разницы «утро (08:00) − день (11:00)» по замерам Яндекса (оба — в центр).

Берётся прямая разность замеров, без модели сети: постоянный сдвиг Яндекса при вычитании уходит.
Интерполяция — ядерное сглаживание Надарая—Уотсона по расстоянию; ширина ядра выбирается по LOO.
Где ближайшая точка дальше MAX_GAP_KM, значения не показываются."""
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

from .field import Grid

BANDWIDTHS_KM = (1.5, 2.5, 4.0, 6.0)
MAX_GAP_KM = 4.0


def nw(px, py, v, qx, qy, h):
    d2 = (qx[:, None] - px[None]) ** 2 + (qy[:, None] - py[None]) ** 2
    w = np.exp(-0.5 * d2 / (h * 1000) ** 2) + 1e-12
    return (w * v[None]).sum(1) / w.sum(1)


def loo(px, py, v, h):
    out = np.empty_like(v)
    for i in range(len(v)):
        m = np.arange(len(v)) != i
        out[i] = nw(px[m], py[m], v[m], px[i:i + 1], py[i:i + 1], h)[0]
    return out


def run(points_csv, times_csv, out_png, out_csv):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from pyproj import Transformer
    from .uds import center_from_layer

    p = pd.read_csv(points_csv).set_index("point_id")
    t = pd.read_csv(times_csv).pivot(index="point_id", columns="slot", values="minutes").reindex(p.index)
    d = t["08:00"] - t["11:00"]
    r = t["08:00"] / t["11:00"]
    px, py = p.x_utm.to_numpy(float), p.y_utm.to_numpy(float)
    cx, cy = Transformer.from_crs(4326, 32637, always_xy=True).transform(*center_from_layer("data/yaroslavl/uds.gpkg"))
    grid = Grid(cx, cy)
    X, Y = grid.centers()
    q = np.c_[X.ravel(), Y.ravel()]
    gap = cKDTree(np.c_[px, py]).query(q)[0].reshape(X.shape)
    mask = gap > MAX_GAP_KM * 1000
    rows, fields = [], {}
    for name, v in (("diff_min", d.to_numpy(float)), ("ratio", r.to_numpy(float))):
        base = np.sqrt(((v - v.mean()) ** 2).mean() * len(v) / (len(v) - 1))  # LOO для константы ≈ std·n/(n−1)
        best = None
        for h in BANDWIDTHS_KM:
            e = float(np.sqrt(((loo(px, py, v, h) - v) ** 2).mean()))
            rows.append(dict(var=name, bandwidth_km=h, loo_rmse=e, const_rmse=base))
            if best is None or e < best[1]:
                best = (h, e)
        f = nw(px, py, v, q[:, 0], q[:, 1], best[0]).reshape(X.shape)
        f[mask] = np.nan
        fields[name] = (f, best, v)
    pd.DataFrame(rows).to_csv(out_csv, index=False)

    fig, axes = plt.subplots(1, 2, figsize=(14, 7), constrained_layout=True)
    for ax, (name, title, cmap) in zip(axes, (("diff_min", "утро − день, минуты (08:00 − 11:00, оба в центр)", "YlOrRd"),
                                              ("ratio", "утро / день, × (08:00 к 11:00)", "YlOrRd"))):
        f, (h, e), v = fields[name]
        lo, hi = np.nanpercentile(v, 5), np.nanpercentile(v, 95)
        im = ax.pcolormesh(grid.xs / 1000, grid.ys / 1000, f, cmap=cmap, vmin=lo, vmax=hi, shading="auto")
        ax.scatter(px / 1000, py / 1000, c=v, cmap=cmap, vmin=lo, vmax=hi, s=28, edgecolor="k", linewidth=0.6)
        ax.plot(cx / 1000, cy / 1000, "s", color="black", ms=6)
        ax.set_xlim(cx / 1000 - 25, cx / 1000 + 25); ax.set_ylim(cy / 1000 - 25, cy / 1000 + 25)
        ax.set_aspect("equal"); ax.set_title(f"{title}\nядро {h} км, LOO-RMSE {e:.2f} (константа {rows[0]['const_rmse'] if name == 'diff_min' else rows[len(BANDWIDTHS_KM)]['const_rmse']:.2f})", fontsize=10)
        fig.colorbar(im, ax=ax, shrink=0.7)
    fig.suptitle("Ярославль: интерполяция разницы утро/день по замерам Яндекса (точки — замеры, показано в пределах 4 км от точек)", fontsize=12)
    fig.savefig(out_png, dpi=150)
    plt.close(fig)
    return pd.DataFrame(rows), d, r


def run_network(path, points_csv, times_csv, out_png, out_csv, bandwidths=(2.0, 3.0, 4.0, 6.0), max_gap_km=5.0):
    """То же, но ядро по длине пути по УДС (через реку — только по мосту). Сравнение с евклидовым ядром по LOO."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from .calibrate_uds import Net

    net = Net(path)
    p = pd.read_csv(points_csv).set_index("point_id")
    tt = pd.read_csv(times_csv)
    tt = tt[tt.status == "ok"]
    t = tt.pivot(index="point_id", columns="slot", values="minutes").reindex(p.index)
    ok = (t["08:00"].notna() & t["11:00"].notna()).to_numpy()
    p, t = p[ok], t[ok]
    d = (t["08:00"] - t["11:00"]).to_numpy(float)
    r = (t["08:00"] / t["11:00"]).to_numpy(float)
    nodes = np.array([net.idx[(int(x), int(y))] for x, y in zip(p.x_utm, p.y_utm)])
    D = net.undirected_dist(nodes)  # точки × узлы
    DP = D[:, nodes] / 1000  # км между точками
    px, py = p.x_utm.to_numpy(float), p.y_utm.to_numpy(float)
    E = np.hypot(px[:, None] - px[None], py[:, None] - py[None]) / 1000
    rows, best_h, fields = [], {}, {}

    def loo_k(Dm, v, h):
        W = np.exp(-0.5 * (Dm / h) ** 2) + 1e-12
        np.fill_diagonal(W, 0)
        return (W * v[None]).sum(1) / W.sum(1)

    for name, v in (("diff_min", d), ("ratio", r)):
        base = float(np.sqrt(((v - v.mean()) ** 2).mean() * len(v) / (len(v) - 1)))
        for kind, Dm, hs in (("euclid", E, (1.5, 2.5, 4.0)), ("network", DP, bandwidths)):
            for h in hs:
                e = float(np.sqrt(((loo_k(Dm, v, h) - v) ** 2).mean()))
                rows.append(dict(var=name, kernel=kind, bandwidth_km=h, loo_rmse=e, const_rmse=base, n=len(v)))
    res = pd.DataFrame(rows)
    res.to_csv(out_csv, index=False)

    # карта по лучшему сетевому ядру
    from .field import Grid
    from scipy.spatial import cKDTree
    xy = np.array(net.nodes, float)
    cx, cy = xy[net.src]
    grid = Grid(cx, cy)
    X, Y = grid.centers()
    q = np.c_[X.ravel(), Y.ravel()]
    dn, ni = cKDTree(xy).query(q)
    far = (dn > 1500) | (np.hypot(q[:, 0] - cx, q[:, 1] - cy) > 30000)
    fig, axes = plt.subplots(1, 2, figsize=(14, 7), constrained_layout=True)
    for ax, (name, v, title) in zip(axes, (("diff_min", d, "утро − день, минуты"), ("ratio", r, "утро / день, ×"))):
        sub = res[(res["var"] == name) & (res.kernel == "network")]
        h = float(sub.loc[sub.loo_rmse.idxmin(), "bandwidth_km"])
        W = np.exp(-0.5 * (D[:, ni] / 1000 + dn[None] / 1000) ** 2 / h ** 2) + 1e-12
        f = (W * v[:, None]).sum(0) / W.sum(0)
        gap = (D[:, ni] / 1000 + dn[None] / 1000).min(0)
        f[(gap > max_gap_km) | far] = np.nan
        f = f.reshape(X.shape)
        lo, hi = np.nanpercentile(v, 5), np.nanpercentile(v, 95)
        im = ax.pcolormesh(grid.xs / 1000, grid.ys / 1000, f, cmap="YlOrRd", vmin=lo, vmax=hi, shading="auto")
        ax.scatter(px / 1000, py / 1000, c=v, cmap="YlOrRd", vmin=lo, vmax=hi, s=24, edgecolor="k", linewidth=0.5)
        ax.plot(cx / 1000, cy / 1000, "s", color="black", ms=6)
        ax.set_xlim(cx / 1000 - 22, cx / 1000 + 22); ax.set_ylim(cy / 1000 - 22, cy / 1000 + 22)
        ax.set_aspect("equal")
        e = sub.loo_rmse.min()
        ax.set_title(f"{title}\nядро по сети {h} км, LOO-RMSE {e:.2f} (константа {sub.const_rmse.iloc[0]:.2f})", fontsize=10)
        fig.colorbar(im, ax=ax, shrink=0.7)
    fig.suptitle(f"Ярославль: интерполяция разницы утро/день по сетевому расстоянию, {len(v)} точек", fontsize=12)
    fig.savefig(out_png, dpi=150)
    plt.close(fig)
    return res
