"""Параметры метода и канонические центры городов (прописные истины §1, §7)."""
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class City:
    key: str
    name: str
    lat: float
    lon: float
    epsg: int  # UTM-зона города (Волгоград — 32638, остальные — 32637)


# Центры 30-км зон: центроиды буферов, проверены 27.09.2026.
CITIES = {
    "krasnodar": City("krasnodar", "Краснодар", 45.035469, 38.975226, 32637),
    "rostov": City("rostov", "Ростов-на-Дону", 47.227518, 39.745030, 32637),
    "voronezh": City("voronezh", "Воронеж", 51.660706, 39.200177, 32637),
    "volgograd": City("volgograd", "Волгоград", 48.707982, 44.515766, 32638),
    # Ярославль — тестовый город, не из §1: центр (Советская площадь) приблизительный,
    # до использования в работе его нужно подтвердить так же, как четыре канонических.
    "yaroslavl": City("yaroslavl", "Ярославль", 57.626569, 39.893813, 32637),
}

# Схема 50 точек: 8 направлений (от севера по часовой) × 6 колец + 2 близкие.
BEARINGS = {"С": 0, "СВ": 45, "В": 90, "ЮВ": 135, "Ю": 180, "ЮЗ": 225, "З": 270, "СЗ": 315}
RING_KM = (3, 8, 13, 18, 23, 28)
NEAR_POINTS = (("З-1.5", 270, 1.5), ("В-1.5", 90, 1.5))  # (метка, азимут, км)
MIN_NODE_DEGREE = 6  # перекрёстки: степень узла в направленном графе

# Замеры: прогноз Яндекса на выбранный день, четыре среза суток.
SLOTS = ("03:00", "08:00", "11:00", "18:00")
SLOT_NETWORK = {"03:00": "free", "08:00": "rush", "11:00": "rush", "18:00": "rush"}  # сценарий сети по умолчанию
DEFAULT_DATE = "2026-10-12"  # понедельник

# Поле времени.
CELL_M = 250.0
ZONE_RADIUS_M = 30_000.0
GRID_MARGIN_M = 2_000.0
OFFROAD_KMH = 20.0  # допуск по бездорожью
ISOCHRONES_MIN = (15, 30, 45, 60)
MIN_ISLAND_KM2 = 80.0

# Скорости по классам дорог, км/ч: (свободный поток, час пик).
# Допущение: в OSM нет трафика, поэтому пик — множитель на свободную скорость.
# Масштаб и сдвиг потом подбирает калибровка по замерам Яндекса.
DEFAULT_SPEEDS = {
    "motorway": 90, "trunk": 80, "primary": 60, "secondary": 50,
    "tertiary": 40, "unclassified": 35, "residential": 30,
    "living_street": 15, "service": 20,
}
RUSH_FACTOR = {
    "motorway": 0.80, "trunk": 0.70, "primary": 0.60, "secondary": 0.60,
    "tertiary": 0.65, "unclassified": 0.75, "residential": 0.80,
    "living_street": 0.90, "service": 0.90,
}

DATA_DIR = Path("data")


def city_dir(city: City, root: Path = DATA_DIR) -> Path:
    d = root / city.key
    d.mkdir(parents=True, exist_ok=True)
    return d
