"""
preprocessing.py
================
Modul untuk pembersihan dan preprocessing data.
Fitur: hapus duplikat, tangani missing values, deteksi tipe kolom.
"""

import pandas as pd
import numpy as np


def detect_column_types(df: pd.DataFrame) -> dict:
    """
    Deteksi otomatis tipe kolom: 'numeric', 'categorical', atau 'datetime'.

    Returns
    -------
    dict  {col_name: 'numeric' | 'categorical' | 'datetime'}
    """
    col_types = {}
    for col in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[col]):
            col_types[col] = "datetime"
        elif pd.api.types.is_numeric_dtype(df[col]):
            col_types[col] = "numeric"
        else:
            # Coba parse sebagai datetime
            sample = df[col].dropna().astype(str).head(50)
            parsed = pd.to_datetime(sample, errors="coerce")
            if parsed.notna().sum() / max(len(sample), 1) >= 0.8:
                col_types[col] = "datetime"
            else:
                col_types[col] = "categorical"
    return col_types


def remove_duplicates(df: pd.DataFrame) -> pd.DataFrame:
    """Menghapus baris duplikat."""
    return df.drop_duplicates().reset_index(drop=True)


def handle_missing_values(df: pd.DataFrame, strategy: str = "mean") -> pd.DataFrame:
    """
    Menangani missing values.

    Parameters
    ----------
    strategy : str
        'mean'   — isi numerik dengan mean, kategorik dengan modus
        'median' — isi numerik dengan median
        'mode'   — isi semua kolom dengan modus
        'drop'   — hapus baris yang mengandung missing value
    """
    df = df.copy()
    if strategy == "drop":
        return df.dropna().reset_index(drop=True)

    for col in df.columns:
        if df[col].isnull().sum() == 0:
            continue
        if pd.api.types.is_numeric_dtype(df[col]):
            if strategy == "median":
                df[col].fillna(df[col].median(), inplace=True)
            elif strategy == "mode":
                df[col].fillna(df[col].mode()[0], inplace=True)
            else:
                df[col].fillna(df[col].mean(), inplace=True)
        else:
            mode_val = df[col].mode()
            if len(mode_val) > 0:
                df[col].fillna(mode_val[0], inplace=True)
    return df


def get_missing_summary(df: pd.DataFrame) -> pd.DataFrame:
    """
    Ringkasan missing values per kolom.

    Returns
    -------
    pd.DataFrame dengan kolom: column, missing_count, missing_pct
    """
    missing = df.isnull().sum()
    missing_pct = (missing / len(df) * 100).round(2)
    summary = pd.DataFrame({
        "column": df.columns,
        "missing_count": missing.values,
        "missing_pct": missing_pct.values,
    })
    return summary[summary["missing_count"] > 0].sort_values("missing_count", ascending=False)
