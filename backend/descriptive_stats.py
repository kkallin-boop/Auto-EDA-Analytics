"""
descriptive_stats.py
====================
Statistik deskriptif lanjutan untuk variabel numerik.
Metrik: mean, median, min, max, std, variance, mode, skewness, kurtosis,
        missing count & %, uji normalitas, jumlah outlier.
"""

import pandas as pd
import numpy as np
from scipy import stats as scipy_stats


def calc_numeric_stats(series: pd.Series) -> dict:
    """
    Hitung statistik lengkap untuk satu kolom numerik.

    Parameters
    ----------
    series : pd.Series

    Returns
    -------
    dict  berisi semua metrik statistik
    """
    clean = series.dropna()
    n = len(series)
    n_clean = len(clean)

    if n_clean == 0:
        return {k: None for k in [
            "count", "mean", "median", "min", "max", "std", "variance",
            "mode", "skewness", "kurtosis", "missing_count", "missing_pct",
            "is_normal", "outlier_count"
        ]}

    # Mode
    mode_result = scipy_stats.mode(clean, keepdims=True)
    mode_val = float(mode_result.mode[0]) if len(mode_result.mode) > 0 else None

    # Uji normalitas (Shapiro-Wilk, max 5000 sampel)
    sample = clean if n_clean <= 5000 else clean.sample(5000, random_state=42)
    try:
        _, p_value = scipy_stats.shapiro(sample)
        is_normal = p_value > 0.05
    except Exception:
        is_normal = None

    # Outlier dengan IQR
    q1 = clean.quantile(0.25)
    q3 = clean.quantile(0.75)
    iqr = q3 - q1
    outlier_count = int(((clean < (q1 - 1.5 * iqr)) | (clean > (q3 + 1.5 * iqr))).sum())

    missing_count = int(n - n_clean)

    return {
        "count": n_clean,
        "mean": round(float(clean.mean()), 4),
        "median": round(float(clean.median()), 4),
        "min": round(float(clean.min()), 4),
        "max": round(float(clean.max()), 4),
        "std": round(float(clean.std()), 4),
        "variance": round(float(clean.var()), 4),
        "mode": round(mode_val, 4) if mode_val is not None else None,
        "skewness": round(float(clean.skew()), 4),
        "kurtosis": round(float(clean.kurtosis()), 4),
        "missing_count": missing_count,
        "missing_pct": round(missing_count / n * 100, 2),
        "is_normal": is_normal,
        "outlier_count": outlier_count,
    }


def get_all_numeric_stats(df: pd.DataFrame) -> pd.DataFrame:
    """
    Hitung statistik deskriptif untuk semua kolom numerik.

    Returns
    -------
    pd.DataFrame  (kolom = kolom data, baris = metrik statistik)
    """
    num_cols = df.select_dtypes(include=[np.number]).columns
    results = {}
    for col in num_cols:
        results[col] = calc_numeric_stats(df[col])
    return pd.DataFrame(results).T
