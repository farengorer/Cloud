"""Конвейер: graph → points → links → (ручные замеры) → isochrones.

    python -m yandex_accessibility graph voronezh
    python -m yandex_accessibility points voronezh
    python -m yandex_accessibility links voronezh --date 2026-10-12
    # заполнить data/voronezh/travel_times.csv (point_id,slot,minutes,km)
    python -m yandex_accessibility isochrones voronezh [--water]
"""
import argparse

import pandas as pd
from pyproj import Transformer

from . import calibrate, field, graph, isochrones, points as pts, yandex_links
from .config import CITIES, DEFAULT_DATE, SLOT_NETWORK, SLOTS, city_dir


def fetch_water(city, grid, path):
    """Водные полигоны OSM (кэш в gpkg) → маска сетки."""
    import geopandas as gpd
    import osmnx as ox

    if path.exists():
        gdf = gpd.read_file(path)
    else:
        tags = {"natural": "water", "landuse": "reservoir", "waterway": "riverbank"}
        gdf = ox.features_from_point((city.lat, city.lon), tags=tags, dist=int(grid.n * grid.cell / 2) + 3000)
        gdf = gdf[gdf.geometry.type.isin(["Polygon", "MultiPolygon"])][["geometry"]].to_crs(city.epsg)
        gdf.to_file(path, driver="GPKG")
    return field.water_mask(grid, gdf)


def cmd_isochrones(city, d, args):
    G = graph.largest_scc(graph.load_graph(d / "graph.graphml"))
    points = pd.read_csv(d / "points.csv")
    meas = yandex_links.load_measurements(d / "travel_times.csv")
    slots = [s for s in SLOTS if s in set(meas["slot"])]
    center_node = graph.nearest_node(G, city.lat, city.lon, city.epsg)
    cx, cy = Transformer.from_crs(4326, city.epsg, always_xy=True).transform(city.lon, city.lat)
    grid = field.Grid(cx, cy)
    water = fetch_water(city, grid, d / "water.gpkg") if args.water else None

    net_times, net_fields = {}, {}
    for scenario in ("free", "rush"):
        net_fields[scenario] = field.build_time_field(G, center_node, city, scenario, grid, water=water)
        net_times[scenario] = {n: G.nodes[n]["tt_to_center"] for n in G.nodes if "tt_to_center" in G.nodes[n]}

    rows, details, panels, titles = [], [], [], []
    for slot in slots:
        row, detail = calibrate.calibrate_slot(points, meas, net_times, slot)
        rows.append(row); details.append(detail.assign(slot=slot))
        panels.append(isochrones.apply_calibration(net_fields[row["scenario"]], row["a"], row["b_min"]))
        titles.append(f"{slot} (сеть: {row['scenario']})")
        print(f"{slot}: сеть={row['scenario']} a={row['a']:.3f} b={row['b_min']:.2f} "
              f"r={row['corr']:.3f} RMSE(сеть/расст./интерп.)="
              f"{row['rmse_network']:.2f}/{row['rmse_distance_only']:.2f}/{row['rmse_interpolation']:.2f}")
    pd.DataFrame(rows).to_csv(d / f"{city.key}_isochrones_yandex_cv.csv", index=False)
    pd.concat(details).to_csv(d / f"{city.key}_calibration_points.csv", index=False)
    isochrones.draw(grid, panels, titles, d / f"{city.key}_isochrones_yandex.png", city.name, water=water)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="yandex_accessibility")
    ap.add_argument("step", choices=["graph", "points", "links", "isochrones"])
    ap.add_argument("city", choices=list(CITIES))
    ap.add_argument("--date", default=DEFAULT_DATE, help="дата отправления (прогноз Яндекса)")
    ap.add_argument("--water", action="store_true", help="учитывать водные объекты OSM (не проходимы вне мостов)")
    ap.add_argument("--data", default=None, help="корневая папка данных (по умолчанию data/)")
    args = ap.parse_args(argv)

    city = CITIES[args.city]
    from pathlib import Path
    d = city_dir(city, Path(args.data)) if args.data else city_dir(city)
    if args.step == "graph":
        graph.download_graph(city, d / "graph.graphml")
    elif args.step == "points":
        G = graph.load_graph(d / "graph.graphml")
        df = pts.select_points(G, city)
        df.to_csv(d / "points.csv", index=False)
        print(df[["point_id", "label", "straight_km", "snap_km"]].to_string(index=False))
    elif args.step == "links":
        df = pd.read_csv(d / "points.csv")
        yandex_links.links_table(df, city, args.date).to_csv(d / "yandex_links.csv", index=False)
        yandex_links.write_html(df, city, args.date, d / "points_yandex.html")
        print(f"Откройте {d / 'points_yandex.html'}, впишите замеры и скачайте CSV как {d / 'travel_times.csv'}")
    else:
        cmd_isochrones(city, d, args)


if __name__ == "__main__":
    main()
