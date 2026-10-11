"""Изохроны 15/30/45 мин по калиброванному полю и рисунок 1×3."""

import contourpy
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from .config import ISOCHRONES_MIN, MIN_ISLAND_KM2  # noqa: E402


def _ring_area_km2(line):
    x, y = line[:, 0], line[:, 1]
    return abs(0.5 * np.sum(x[:-1] * y[1:] - x[1:] * y[:-1])) / 1e6


def _contains(line, px, py):
    from matplotlib.path import Path

    return Path(line).contains_point((px, py))


def isochrone_lines(grid, field_min, level, min_island_km2=MIN_ISLAND_KM2):
    """Линии уровня `level` (мин). Мелкие замкнутые «острова» отбрасываются, кроме петли,
    охватывающей центр: в пик 15-минутная изохрона мала, но это и есть изохрона."""
    z = np.ma.masked_invalid(field_min)
    gen = contourpy.contour_generator(grid.xs, grid.ys, z)
    keep = []
    for line in gen.lines(level):
        closed = np.allclose(line[0], line[-1])
        if closed and _ring_area_km2(line) < min_island_km2 and not _contains(line, grid.cx, grid.cy):
            continue
        keep.append(line)
    return keep


def apply_calibration(field_min, a, b):
    return a * field_min + b


def draw(grid, fields, titles, out_png, city_name, levels=ISOCHRONES_MIN, water=None, pdf=True):
    """fields: список полей (мин по шкале Яндекса), по одной панели на срез суток."""
    fig, axes = plt.subplots(1, len(fields), figsize=(5.4 * len(fields), 5.8), constrained_layout=True)
    axes = np.atleast_1d(axes)
    ext = [grid.xs[0] / 1000, grid.xs[-1] / 1000, grid.ys[0] / 1000, grid.ys[-1] / 1000]
    shades = ["#9ecae1", "#4292c6", "#08519c", "#08306b"]
    for ax, field, title in zip(axes, fields, titles):
        if water is not None:
            ax.imshow(np.where(water, 1.0, np.nan), extent=ext, origin="lower", cmap="Blues", vmin=0, vmax=2, zorder=0)
        for level, color in zip(levels, shades):
            lines = isochrone_lines(grid, field, level)
            if not lines:
                continue  # изохроны не видно: время в зоне до этого уровня не доходит
            for ln in lines:
                ax.plot(ln[:, 0] / 1000, ln[:, 1] / 1000, color=color, lw=1.6, zorder=2)
            top = max((ln[np.argmax(ln[:, 1])] for ln in lines), key=lambda p: p[1])
            ax.annotate(f"{level} мин", (top[0] / 1000, top[1] / 1000), xytext=(0, 4),
                        textcoords="offset points", ha="center", va="bottom", fontsize=9, color=color)
        ax.plot(grid.cx / 1000, grid.cy / 1000, "s", color="black", ms=6, zorder=3)  # центр
        ax.set_xlim(ext[0] + 2, ext[1] - 2); ax.set_ylim(ext[2] + 2, ext[3] - 2)
        ax.set_aspect("equal"); ax.set_title(title, fontsize=11)
        ax.set_xlabel("x, км (UTM)"); ax.tick_params(labelsize=8)
    axes[0].set_ylabel("y, км (UTM)")
    fig.suptitle(f"{city_name}: изохроны доступности центра по прогнозу Яндекс Карт", fontsize=12)
    fig.savefig(out_png, dpi=200)
    if pdf:
        fig.savefig(str(out_png).rsplit(".", 1)[0] + ".pdf")
    plt.close(fig)
