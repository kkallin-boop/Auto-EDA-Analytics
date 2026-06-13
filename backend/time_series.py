"""
time_series.py
==============
Modul analisis Time Series (auto-detection).
Fitur: deteksi kolom datetime, trend line, moving average, rolling mean, line chart.
"""

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import os

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "outputs", "charts")
os.makedirs(OUTPUT_DIR, exist_ok=True)


def detect_datetime_columns(df: pd.DataFrame) -> list:
    """
    Deteksi otomatis kolom yang berisi data datetime.

    Returns
    -------
    list  nama kolom datetime
    """
    datetime_cols = []
    for col in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[col]):
            datetime_cols.append(col)
        else:
            sample = df[col].dropna().astype(str).head(100)
            parsed = pd.to_datetime(sample, errors="coerce")
            if parsed.notna().sum() / max(len(sample), 1) >= 0.8:
                datetime_cols.append(col)
    return datetime_cols


def prepare_time_series(df: pd.DataFrame, date_col: str, value_col: str,
                         freq: str = "D") -> pd.DataFrame:
    """
    Siapkan time series: parse tanggal, set index, resample.

    Parameters
    ----------
    freq : str  Frekuensi resample ('D'=daily, 'W'=weekly, 'M'=monthly)
    """
    ts = df[[date_col, value_col]].copy()
    ts[date_col] = pd.to_datetime(ts[date_col], errors="coerce")
    ts = ts.dropna().set_index(date_col).sort_index()
    ts = ts[value_col].resample(freq).mean()
    return ts


def calc_moving_average(ts: pd.Series, window: int = 7) -> pd.Series:
    """Hitung simple moving average."""
    return ts.rolling(window=window, min_periods=1).mean()


def calc_rolling_mean(ts: pd.Series, window: int = 30) -> pd.Series:
    """Hitung rolling mean dengan window lebih besar."""
    return ts.rolling(window=window, min_periods=1).mean()


def calc_trend_line(ts: pd.Series):
    """
    Hitung garis trend linear.

    Returns
    -------
    tuple (x_num, trend_values)
    """
    x = np.arange(len(ts))
    mask = ~np.isnan(ts.values)
    if mask.sum() < 2:
        return x, np.full(len(ts), np.nan)
    coeffs = np.polyfit(x[mask], ts.values[mask], 1)
    trend = np.polyval(coeffs, x)
    return x, trend


def plot_time_series(ts: pd.Series, title: str = "Time Series",
                      show_ma: bool = True, ma_window: int = 7) -> str:
    """
    Plot time series line chart dengan moving average dan trend line.
    """
    fig, ax = plt.subplots(figsize=(12, 5))
    ax.plot(ts.index, ts.values, color="#4a9ee8", linewidth=1.5,
            alpha=0.8, label="Actual")

    if show_ma:
        ma = calc_moving_average(ts, window=ma_window)
        ax.plot(ts.index, ma.values, color="#f5a623", linewidth=2,
                linestyle="--", label=f"MA({ma_window})")

    _, trend = calc_trend_line(ts)
    ax.plot(ts.index, trend, color="#e85d5d", linewidth=1.5,
            linestyle=":", label="Trend")

    ax.set_title(title, fontsize=14, fontweight="bold")
    ax.set_xlabel("Date")
    ax.set_ylabel("Value")
    ax.legend()
    ax.grid(True, alpha=0.3)

    path = os.path.join(OUTPUT_DIR, f"timeseries_{ts.name or 'chart'}.png")
    fig.savefig(path, bbox_inches="tight", dpi=150, facecolor="white")
    plt.close()
    return path


def get_time_series_summary(ts: pd.Series) -> dict:
    """
    Ringkasan statistik time series: trend arah, volatilitas, dll.
    """
    clean = ts.dropna()
    if len(clean) < 2:
        return {"error": "Data tidak cukup untuk analisis time series."}

    _, trend_vals = calc_trend_line(clean)
    trend_direction = "Naik" if trend_vals[-1] > trend_vals[0] else "Turun"
    trend_strength = abs(trend_vals[-1] - trend_vals[0])

    return {
        "start_date": str(clean.index.min().date()),
        "end_date": str(clean.index.max().date()),
        "total_periods": len(clean),
        "mean": round(float(clean.mean()), 4),
        "min": round(float(clean.min()), 4),
        "max": round(float(clean.max()), 4),
        "std": round(float(clean.std()), 4),
        "trend_direction": trend_direction,
        "trend_strength": round(float(trend_strength), 4),
        "cv_pct": round(float(clean.std() / clean.mean() * 100), 2) if clean.mean() != 0 else None,
    }
