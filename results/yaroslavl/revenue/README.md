# Выручка ККТ (H3 r10, неделя 19–25.10.2026) и доступность

- `revenue_vs_accessibility.png`, `revenue_hex_accessibility.gpkg`, `revenue_by_time_band.csv`, `revenue_inside_isochrones_0800.csv` — ячейки H3 со временем до центра (08:00/11:00/18:00), потерей утром, прогнозом по проекту.
- `revenue_ideas.png` — сводка по четырём идеям.
- Идея 1 (покупательские поездки в модели спроса): `evening_shopping_validation.csv`, `evening_placebo.csv`.
- Идея 2 (районные эластичности выручки): `retail_scenario_by_district.csv`.
- Идея 3 (экономический приоритет дорог): `road_priority_by_street.csv`, `road_priority_edges.gpkg`, `uds_econ_priority.gpkg` (исходный УДС с полями `W_млн`, `delay_мин`, `exposure`).
- Идея 4 (часы суток × пробки): `hours_x_congestion_by_district.csv`.

Код: `yandex_accessibility/revenue.py`, `retail_model.py`.
