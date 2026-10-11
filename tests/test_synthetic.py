"""Сквозная проверка на синтетическом городе без доступа к OSM и Яндексу."""
import networkx as nx
import numpy as np
import pandas as pd
from pyproj import Transformer

from yandex_accessibility import calibrate, field, graph, isochrones, points as pts, yandex_links
from yandex_accessibility.config import CITIES

CITY = CITIES["yaroslavl"]
STEP = 1000.0  # шаг дорожной решётки, м
N = 61         # ±30 км


def make_graph():
    to_wgs = Transformer.from_crs(CITY.epsg, 4326, always_xy=True)
    cx, cy = Transformer.from_crs(4326, CITY.epsg, always_xy=True).transform(CITY.lon, CITY.lat)
    G = nx.MultiDiGraph()
    for i in range(N):
        for j in range(N):
            lon, lat = to_wgs.transform(cx + (i - N // 2) * STEP, cy + (j - N // 2) * STEP)
            G.add_node(i * N + j, x=lon, y=lat)
    for i in range(N):
        for j in range(N):
            for di, dj in ((1, 0), (0, 1)):
                a, b = i * N + j, (i + di) * N + j + dj
                if i + di < N and j + dj < N:
                    hw = "primary" if i == N // 2 or j == N // 2 else "residential"
                    for u, v in ((a, b), (b, a)):
                        G.add_edge(u, v, length=STEP, highway=hw)
    return G, cx, cy


def isochrone_lines_ok(grid, panel):
    return bool(isochrones.isochrone_lines(grid, panel, 30))


def test_pipeline(tmp_path):
    G, cx, cy = make_graph()
    center = (N // 2) * N + N // 2
    points = pts.select_points(G, CITY)
    assert len(points) == 50 and points["snap_km"].max() < 1.5

    grid = field.Grid(cx, cy)
    # «река» шириной 1 км, мост — главная улица
    X, Y = grid.centers()
    water = (np.abs(X - (cx + 6000)) < 500) & (np.abs(Y - cy) > 600)
    free = field.build_time_field(G, center, CITY, "free", grid, water=water)
    rush = field.build_time_field(G, center, CITY, "rush", grid, water=water)
    assert np.isnan(free[water]).sum() > 0 or water.sum() > 0
    assert np.nanmax(rush) >= np.nanmax(free) > 0

    assert len(yandex_links.links_table(points, CITY, '2026-10-12')) == 200  # 50 точек × 4 среза

    # синтетические «замеры Яндекса»: t = 1.05 t_сеть + 5 + шум
    net = {"free": {}, "rush": {}}
    for sc in net:
        graph.set_edge_times(G, sc)
        net[sc] = graph.times_to_center(G, center)
    rng = np.random.default_rng(0)
    m = pd.DataFrame({
        "point_id": points.point_id, "slot": "03:00",
        "minutes": [1.05 * net["free"][n] / 60 + 5 + rng.normal(0, 1) for n in points.node],
    })
    row, _ = calibrate.calibrate_slot(points, m, net, "03:00")
    assert row["scenario"] == "free" and abs(row["a"] - 1.05) < 0.1
    assert row["rmse_network"] < row["rmse_distance_only"]

    # час пик: срезы 08:00, 11:00 и 18:00 должны выбрать сценарий «rush»
    panels = [isochrones.apply_calibration(free, row["a"], row["b_min"])]
    for slot, k in (("08:00", 0.85), ("11:00", 0.8), ("18:00", 0.9)):
        mm = pd.DataFrame({"point_id": points.point_id, "slot": slot,
                           "minutes": [k * net["rush"][n] / 60 + 6 + rng.normal(0, 1) for n in points.node]})
        r, _ = calibrate.calibrate_slot(points, mm, net, slot)
        assert r["scenario"] == "rush" and abs(r["a"] - k) < 0.1, (slot, r)
        panels.append(isochrones.apply_calibration(rush, r["a"], r["b_min"]))
    assert isochrone_lines_ok(grid, panels[0])
    isochrones.draw(grid, panels, ["03:00", "08:00", "11:00", "18:00"], tmp_path / "iso.png", CITY.name, water=water)
    assert (tmp_path / "iso.png").exists()


def test_links_and_parsing(tmp_path):
    G, *_ = make_graph()
    points = pts.select_points(G, CITY)
    url = yandex_links.route_url(51.6, 39.2, CITY, "2026-10-12", "08:00")
    assert "timeDependent" in url and "2026-10-12T08%3A00%3A00" in url
    yandex_links.write_html(points, CITY, "2026-10-12", tmp_path / "p.html")
    assert yandex_links.parse_minutes("1 ч 5 мин") == 65 and yandex_links.parse_minutes("27,5") == 27.5
