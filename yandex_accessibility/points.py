"""Выбор 50 точек замера на перекрёстках дорожной сети."""
import numpy as np
import pandas as pd
from pyproj import Transformer
from scipy.spatial import cKDTree

from .config import BEARINGS, MIN_NODE_DEGREE, NEAR_POINTS, RING_KM, City
from .graph import largest_scc, node_xy


def select_points(G, city: City) -> pd.DataFrame:
    """8 направлений × 6 колец + 2 близкие точки. Каждая привязана к ближайшему
    перекрёстку (степень ≥ MIN_NODE_DEGREE) самой большой сильно связной части графа.
    `straight_km` — фактическое расстояние по прямой от центра, `snap_km` — сдвиг привязки."""
    G = largest_scc(G)
    ids, x, y = node_xy(G, city.epsg)
    deg = np.array([G.degree(n) for n in ids])
    mask = deg >= MIN_NODE_DEGREE
    ids, x, y = ids[mask], x[mask], y[mask]
    tree = cKDTree(np.c_[x, y])

    to_utm = Transformer.from_crs(4326, city.epsg, always_xy=True)
    to_wgs = Transformer.from_crs(city.epsg, 4326, always_xy=True)
    cx, cy = to_utm.transform(city.lon, city.lat)

    targets = [(f"{name}-{ring}", az, ring) for ring in RING_KM for name, az in BEARINGS.items()]
    targets += [(label, az, km) for label, az, km in NEAR_POINTS]

    rows = []
    for label, az, km in targets:
        tx = cx + km * 1000 * np.sin(np.radians(az))
        ty = cy + km * 1000 * np.cos(np.radians(az))
        d, i = tree.query([tx, ty])
        lon, lat = to_wgs.transform(x[i], y[i])
        rows.append({
            "point_id": len(rows) + 1, "label": label, "bearing": az, "ring_km": km,
            "node": int(ids[i]), "lat": lat, "lon": lon,
            "straight_km": float(np.hypot(x[i] - cx, y[i] - cy) / 1000),
            "snap_km": float(d / 1000),
        })
    return pd.DataFrame(rows)
