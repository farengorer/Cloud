"""Калибровка сети по замерам: t_Яндекс = a·t_сеть + b (МНК) и перекрёстная проверка
«одна точка вне выборки» против двух простых базовых моделей."""
import numpy as np
import pandas as pd
from scipy.interpolate import RBFInterpolator


def fit_linear(t_net, t_obs):
    a, b = np.polyfit(t_net, t_obs, 1)
    return float(a), float(b)


def _loo(predict_fn, n):
    err = []
    for i in range(n):
        train = np.arange(n) != i
        err.append(predict_fn(train, i))
    return float(np.sqrt(np.mean(np.square(err))))


def cross_validate(t_net, t_obs, xy_km, straight_km) -> dict:
    """RMSE (мин) по схеме leave-one-out для трёх моделей."""
    t_net, t_obs, straight_km = map(np.asarray, (t_net, t_obs, straight_km))
    n = len(t_obs)

    def net(train, i):
        a, b = fit_linear(t_net[train], t_obs[train])
        return a * t_net[i] + b - t_obs[i]

    def dist(train, i):  # радиальная кривая «время от расстояния»
        p = np.polyfit(straight_km[train], t_obs[train], 2)
        return np.polyval(p, straight_km[i]) - t_obs[i]

    def interp(train, i):  # чисто пространственная интерполяция точек
        f = RBFInterpolator(xy_km[train], t_obs[train], kernel="thin_plate_spline", smoothing=1.0)
        return f(xy_km[i:i + 1])[0] - t_obs[i]

    return {"rmse_network": _loo(net, n), "rmse_distance_only": _loo(dist, n), "rmse_interpolation": _loo(interp, n)}


def calibrate_slot(points: pd.DataFrame, meas: pd.DataFrame, net_times: dict, slot: str):
    """`net_times`: сценарий -> {node: сек до центра}. Для слота перебираются оба сценария
    сети и выбирается тот, у которого меньше ошибка перекрёстной проверки.
    Возвращает (строка итогов, таблица точек с невязками)."""
    m = meas[meas["slot"] == slot].merge(points, on="point_id")
    if len(m) < 5:
        raise ValueError(f"слот {slot}: слишком мало замеров ({len(m)})")
    angle = np.radians(m["bearing"].to_numpy())
    xy = np.c_[m["straight_km"] * np.sin(angle), m["straight_km"] * np.cos(angle)]
    best = None
    for scenario, tt in net_times.items():
        t_net = np.array([tt[n] / 60.0 for n in m["node"]])
        cv = cross_validate(t_net, m["minutes"].to_numpy(), xy, m["straight_km"].to_numpy())
        if best is None or cv["rmse_network"] < best[1]["rmse_network"]:
            best = (scenario, cv, t_net)
    scenario, cv, t_net = best
    a, b = fit_linear(t_net, m["minutes"].to_numpy())
    corr = float(np.corrcoef(t_net, m["minutes"])[0, 1])
    row = {"slot": slot, "scenario": scenario, "a": a, "b_min": b, "corr": corr, "n": len(m), **cv}
    detail = m.assign(t_net_min=t_net, t_fit_min=a * t_net + b)
    detail["resid_min"] = detail["minutes"] - detail["t_fit_min"]
    return row, detail
