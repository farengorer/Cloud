"""Дорожный граф OSM: загрузка, скорости, время в пути до центра."""
from pathlib import Path

import networkx as nx
import numpy as np
from pyproj import Transformer

from .config import DEFAULT_SPEEDS, RUSH_FACTOR, City


def download_graph(city: City, path: Path, dist_m: int = 40_000) -> nx.MultiDiGraph:
    import osmnx as ox

    G = ox.graph_from_point((city.lat, city.lon), dist=dist_m, network_type="drive", simplify=True)
    ox.save_graphml(G, path)
    return G


def load_graph(path: Path) -> nx.MultiDiGraph:
    import osmnx as ox

    return ox.load_graphml(path)


def largest_scc(G: nx.MultiDiGraph) -> nx.MultiDiGraph:
    nodes = max(nx.strongly_connected_components(G), key=len)
    return G.subgraph(nodes).copy()


def _road_class(highway) -> str:
    if isinstance(highway, list):
        highway = highway[0]
    h = str(highway).replace("_link", "")
    return h if h in DEFAULT_SPEEDS else "unclassified"


def _maxspeed_kmh(value):
    if isinstance(value, list):
        value = value[0]
    try:
        v = float(str(value).split()[0])
    except (ValueError, TypeError):
        return None
    return v * 1.609 if "mph" in str(value) else v


def set_edge_times(G: nx.MultiDiGraph, scenario: str) -> None:
    """Пишет в рёбра `tt_sec` для сценария 'free' (свободный поток) или 'rush' (час пик)."""
    if scenario not in ("free", "rush"):
        raise ValueError(scenario)
    for _, _, _, d in G.edges(keys=True, data=True):
        cls = _road_class(d.get("highway"))
        v = _maxspeed_kmh(d.get("maxspeed")) or DEFAULT_SPEEDS[cls]
        if scenario == "rush":
            v *= RUSH_FACTOR[cls]
        d["tt_sec"] = d["length"] / (v / 3.6)


def times_to_center(G: nx.MultiDiGraph, center_node: int) -> dict:
    """Время в пути от каждого узла ДО центра, сек (поездка из точки в центр)."""
    return nx.single_source_dijkstra_path_length(G.reverse(copy=False), center_node, weight="tt_sec")


def node_xy(G: nx.MultiDiGraph, epsg: int):
    """Узлы графа в UTM: (ids, x, y)."""
    ids = np.array(list(G.nodes))
    lon = np.array([G.nodes[n]["x"] for n in ids])
    lat = np.array([G.nodes[n]["y"] for n in ids])
    x, y = Transformer.from_crs(4326, epsg, always_xy=True).transform(lon, lat)
    return ids, np.asarray(x), np.asarray(y)


def nearest_node(G: nx.MultiDiGraph, lat: float, lon: float, epsg: int) -> int:
    from scipy.spatial import cKDTree

    ids, x, y = node_xy(G, epsg)
    px, py = Transformer.from_crs(4326, epsg, always_xy=True).transform(lon, lat)
    return int(ids[cKDTree(np.c_[x, y]).query([px, py])[1]])
