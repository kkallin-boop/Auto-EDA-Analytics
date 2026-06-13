"""
data_loader.py
==============
Modul untuk membaca file data (Excel, CSV, TXT) dan mendeteksi tipe kolom secara otomatis.
Bagian dari Auto EDA Analytics Dashboard - SD-1306 Data Science Programming
"""

import pandas as pd
import numpy as np
import os


SUPPORTED_EXTENSIONS = [".xlsx", ".xls", ".csv", ".txt"]


def load_file(file_path: str) -> pd.DataFrame:
    """
    Membaca file data berdasarkan ekstensinya.
    Mendukung: Excel (.xlsx/.xls), CSV (.csv), Text (.txt)

    Parameters
    ----------
    file_path : str
        Path file yang akan dibaca

    Returns
    -------
    pd.DataFrame
        DataFrame hasil pembacaan
    """
    ext = os.path.splitext(file_path)[-1].lower()

    if ext in (".xlsx", ".xls"):
        df = pd.read_excel(file_path)
        # Deteksi Excel yang sebenarnya berisi CSV dalam satu kolom
        if (
            df.shape[1] == 1
            and len(df) > 0
        ):
            first_value = str(df.iloc[0, 0])
            
            if (
                "," in first_value
                or ";" in first_value
                or "\t" in first_value
            ):
                try:
                    import io
                    
                    # Ambil seluruh isi kolom menjadi string CSV
                    csv_text = "\n".join(
                        df.iloc[:, 0]
                        .astype(str)
                        .tolist()
                    )
                    
                    # Coba parse ulang sebagai CSV
                    for sep in [",", ";", "\t", "|"]:
                        try:
                            parsed = pd.read_csv(
                                io.StringIO(csv_text),
                                sep=sep
                            )
                            
                            if parsed.shape[1] > 1:
                                df = parsed
                                break
                        
                        except Exception:
                            continue
                except Exception:
                    pass
    elif ext == ".csv":
        # Coba beberapa delimiter umum
        for sep in [",", ";", "\t", "|"]:
            try:
                df = pd.read_csv(file_path, sep=sep)
                if df.shape[1] > 1:
                    break
            except Exception:
                continue
        else:
            df = pd.read_csv(file_path)
    elif ext == ".txt":
        for sep in ["\t", ",", ";", "|", " "]:
            try:
                df = pd.read_csv(file_path, sep=sep)
                if df.shape[1] > 1:
                    break
            except Exception:
                continue
        else:
            df = pd.read_csv(file_path, sep="\t")
    else:
        raise ValueError(f"Format file tidak didukung: {ext}. "
                         f"Gunakan: {', '.join(SUPPORTED_EXTENSIONS)}")

    return df


def get_dataset_info(df: pd.DataFrame, file_path: str = None) -> dict:
    """
    Menghasilkan informasi ringkas tentang dataset.

    Parameters
    ----------
    df : pd.DataFrame
    file_path : str, optional

    Returns
    -------
    dict
        Informasi dataset (baris, kolom, tipe data, missing values, dll.)
    """
    total_cells = df.shape[0] * df.shape[1]
    missing_total = df.isnull().sum().sum()

    info = {
        "file_name": os.path.basename(file_path) if file_path else "unknown",
        "file_size_kb": round(os.path.getsize(file_path) / 1024, 1) if file_path else None,
        "rows": df.shape[0],
        "columns": df.shape[1],
        "numeric_cols": int(df.select_dtypes(include=[np.number]).shape[1]),
        "categorical_cols": int(df.select_dtypes(include=["object", "category"]).shape[1]),
        "datetime_cols": int(df.select_dtypes(include=["datetime"]).shape[1]),
        "missing_total": int(missing_total),
        "missing_pct": round(missing_total / total_cells * 100, 2) if total_cells > 0 else 0,
        "duplicate_rows": int(df.duplicated().sum()),
        "memory_mb": round(df.memory_usage(deep=True).sum() / 1024 / 1024, 3),
    }
    return info
