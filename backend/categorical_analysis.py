"""
categorical_analysis.py
========================
Analisis statistik untuk variabel kategorik.
Metrik: unique categories, mode, mode frequency, mode %, missing count & %.
"""

import pandas as pd
import numpy as np


def calc_categorical_stats(series: pd.Series) -> dict:
    """
    Hitung statistik untuk satu kolom kategorik.

    Returns
    -------
    dict  berisi semua metrik kategorik
    """
    n = len(series)
    clean = series.dropna()
    n_clean = len(clean)
    missing_count = n - n_clean

    value_counts = clean.value_counts()
    unique_count = series.nunique()

    if n_clean > 0:
        mode_val = value_counts.index[0]
        mode_freq = int(value_counts.iloc[0])
        mode_pct = round(mode_freq / n * 100, 2)
    else:
        mode_val = None
        mode_freq = 0
        mode_pct = 0.0

    return {
        "unique_categories": unique_count,
        "mode": mode_val,
        "mode_frequency": mode_freq,
        "mode_pct": mode_pct,
        "missing_count": missing_count,
        "missing_pct": round(missing_count / n * 100, 2),
        "top_categories": value_counts.head(10).to_dict(),
    }


def get_all_categorical_stats(df: pd.DataFrame) -> pd.DataFrame:
    """
    Hitung statistik kategorik untuk semua kolom non-numerik.

    Returns
    -------
    pd.DataFrame
    """
    cat_cols = df.select_dtypes(include=["object", "category"]).columns
    results = {}
    for col in cat_cols:
        results[col] = calc_categorical_stats(df[col])
    # Drop top_categories from the main table (it's a nested dict)
    result_df = pd.DataFrame(results).T
    if "top_categories" in result_df.columns:
        result_df = result_df.drop(columns=["top_categories"])
    return result_df


def get_top_categories(df: pd.DataFrame, col: str, top_n: int = 10) -> pd.DataFrame:
    """
    Mengembalikan top-N kategori dengan frekuensinya.
    """
    vc = df[col].value_counts().head(top_n).reset_index()
    vc.columns = ["category", "count"]
    vc["pct"] = round(vc["count"] / len(df) * 100, 2)
    return vc
