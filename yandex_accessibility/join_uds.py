"""Склейка расчётных значений с исходным слоем УДС (исходная геометрия и атрибуты сохраняются)."""
import geopandas as gpd
import numpy as np
import pandas as pd


def key_pair(p, q):
    a, b = (round(p[0]), round(p[1])), (round(q[0]), round(q[1]))
    return (a, b) if a <= b else (b, a)


def edges_dict(path):
    g = gpd.read_file(path).to_crs(32637)
    d = {}
    for r in g.drop(columns="geometry").itertuples(index=False), g.geometry:
        pass
    cols = [c for c in g.columns if c != "geometry"]
    for geom, row in zip(g.geometry, g[cols].itertuples(index=False)):
        c = list(geom.coords)
        d[key_pair(c[0], c[-1])] = dict(zip(cols, row))
    return d


def run(uds, minutes, ratio, forecast, out):
    src = gpd.read_file(uds)
    utm = src.to_crs(32637)
    dm, dr, df = edges_dict(minutes), edges_dict(ratio), edges_dict(forecast)
    keep = {"t_0800": dm, "t_1100": dm, "t_1800": dm, "gap_km": dm, "ratio": dr, "diff_min": dr,
            "vc_base": df, "vc_s1": df, "vc_s2": df, "d_s1": df, "d_s2": df, "cap": df}
    new = {c: [np.nan] * len(src) for c in keep}
    ing = []
    for i, geom in enumerate(utm.geometry):
        parts = list(geom.geoms)
        c0, c1 = list(parts[0].coords), list(parts[-1].coords)
        k = key_pair(c0[0], c1[-1])
        hit = [k in d for d in (dm, dr, df)]
        ing.append(any(hit))
        for c, d in keep.items():
            if k in d:
                new[c][i] = d[k][c]
    for c, v in new.items():
        src[c] = v
    src["in_graph"] = ing
    src.to_file(out, layer="uds_calculated", driver="GPKG")
    return src
