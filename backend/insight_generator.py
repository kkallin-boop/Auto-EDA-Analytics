"""
insight_generator.py
====================
Modul pembuat insight otomatis berbasis data.
Menghasilkan interpretasi: mean tertinggi, outlier terbanyak, korelasi terkuat, dll.
"""

import pandas as pd
import numpy as np
from scipy import stats as scipy_stats


def generate_insights(df: pd.DataFrame) -> list:
    """
    Hasilkan daftar insight otomatis dari dataset.

    Returns
    -------
    list of str  (setiap item = satu insight)
    """
    insights = []
    num_df = df.select_dtypes(include=[np.number])
    cat_df = df.select_dtypes(include=["object", "category"])

    # 1. Variabel dengan rata-rata tertinggi
    if not num_df.empty:
        top_mean_col = num_df.mean().idxmax()
        top_mean_val = round(num_df[top_mean_col].mean(), 2)
        insights.append(
            f"Rata-rata tertinggi: '{top_mean_col}' "
            f"(mean = {top_mean_val:,})"
        )

    # 2. Variabel dengan standar deviasi terbesar
    if not num_df.empty:
        top_std_col = num_df.std().idxmax()
        top_std_val = round(num_df[top_std_col].std(), 2)
        insights.append(
            f"Variabilitas terbesar: '{top_std_col}' "
            f"(std = {top_std_val:,}) — data paling tersebar/tidak konsisten"
        )

    # 3. Variabel dengan outlier terbanyak (IQR method)
    if not num_df.empty:
        outlier_counts = {}
        for col in num_df.columns:
            clean = num_df[col].dropna()
            q1, q3 = clean.quantile(0.25), clean.quantile(0.75)
            iqr = q3 - q1
            outlier_counts[col] = int(
                ((clean < q1 - 1.5 * iqr) | (clean > q3 + 1.5 * iqr)).sum()
            )
        top_outlier_col = max(outlier_counts, key=outlier_counts.get)
        n_outlier = outlier_counts[top_outlier_col]
        if n_outlier > 0:
            pct = round(n_outlier / len(df) * 100, 1)
            if n_outlier > 50:
                keterangan = "Jumlah outlier sangat tinggi, perlu penanganan serius sebelum modeling."
            elif n_outlier > 10:
                keterangan = "Outlier cukup signifikan, pertimbangkan transformasi atau robust scaling."
            else:
                keterangan = "Outlier relatif sedikit, masih bisa ditoleransi untuk analisis deskriptif."
            insights.append(
                f"Outlier terbanyak: '{top_outlier_col}' "
                f"({n_outlier} data / {pct}%) — {keterangan}"
            )

    # 4. Distribusi skewed
    if not num_df.empty:
        for col in num_df.columns:
            clean = num_df[col].dropna()
            skewness = round(float(clean.skew()), 3)
            if abs(skewness) > 1:
                arah = "right skewed" if skewness > 0 else "left skewed"
                makna = (
                    "Data condong ke kiri, terdapat nilai ekstrem di kanan."
                    if skewness > 0
                    else "Data condong ke kanan, terdapat nilai ekstrem di kiri."
                )
                insights.append(
                    f"Distribusi '{col}': {arah} "
                    f"(skewness = {skewness}) — {makna}"
                )

    # 5. Korelasi terkuat antar variabel numerik
    if num_df.shape[1] >= 2:
        corr_matrix = num_df.corr().abs()
        np.fill_diagonal(corr_matrix.values, 0)
        max_corr_val = corr_matrix.max().max()
        idx = corr_matrix.stack().idxmax()
        strength = (
            "Korelasi kuat — kedua variabel sangat berkaitan."
            if max_corr_val > 0.7
            else "Korelasi sedang — ada hubungan moderat."
            if max_corr_val > 0.4
            else "Korelasi lemah — hubungan antar variabel tidak terlalu signifikan."
        )
        insights.append(
            f"Korelasi terkuat: '{idx[0]}' vs '{idx[1]}' "
            f"(r = {round(max_corr_val, 3)}) — {strength}"
        )

    # 6. Kategori dominan
    if not cat_df.empty:
        for col in cat_df.columns:
            top_cat = df[col].value_counts().index[0]
            top_pct = round(df[col].value_counts().iloc[0] / len(df) * 100, 1)
            unique = df[col].nunique()
            insights.append(
                f"'{col}': {unique} kategori unik, "
                f"dominan '{top_cat}' ({top_pct}%)"
            )

    return insights


def generate_recommendations(df: pd.DataFrame) -> list:
    """
    Hasilkan daftar rekomendasi otomatis berdasarkan kondisi dataset.

    Returns
    -------
    list of str
    """
    recommendations = []
    num_df = df.select_dtypes(include=[np.number])
    cat_df = df.select_dtypes(include=["object", "category"])

    # Rekomendasi skewed
    skewed_vars = []
    for col in num_df.columns:
        skewness = abs(float(num_df[col].dropna().skew()))
        if skewness >= 0.5:
            skewed_vars.append(col)
    if skewed_vars:
        recommendations.append(
            f"Variabel {', '.join(skewed_vars)} memiliki distribusi skewed. "
            f"Disarankan transformasi log atau normalisasi sebelum modeling."
        )

    # Rekomendasi outlier
    outlier_vars = []
    for col in num_df.columns:
        clean = num_df[col].dropna()
        q1, q3 = clean.quantile(0.25), clean.quantile(0.75)
        iqr = q3 - q1
        n = int(((clean < q1 - 1.5*iqr) | (clean > q3 + 1.5*iqr)).sum())
        if n > 0:
            outlier_vars.append(col)
    if outlier_vars:
        recommendations.append(
            f"Variabel {', '.join(outlier_vars)} masih memiliki outlier. "
            f"Pertimbangkan winsorizing, trimming, atau robust scaling "
            f"apabila dataset akan digunakan untuk machine learning."
        )

    # Rekomendasi imbalanced kategori
    imbalanced_vars = []
    for col in cat_df.columns:
        top_pct = df[col].value_counts().iloc[0] / len(df) * 100
        if top_pct >= 70:
            imbalanced_vars.append(col)
    if imbalanced_vars:
        recommendations.append(
            f"Variabel {', '.join(imbalanced_vars)} memiliki distribusi "
            f"kategori tidak seimbang. Pertimbangkan balancing data "
            f"jika digunakan untuk klasifikasi."
        )

    # Status missing & duplikat
    if df.isnull().sum().sum() == 0 and df.duplicated().sum() == 0:
        recommendations.append(
            "Dataset telah bersih dari missing values dan duplicate rows, "
            "sehingga siap digunakan untuk analisis lanjutan."
        )

    # Rekomendasi korelasi lemah
    if num_df.shape[1] >= 2:
        corr_matrix = num_df.corr().abs()
        np.fill_diagonal(corr_matrix.values, 0)
        max_corr = corr_matrix.max().max()
        if max_corr < 0.3:
            recommendations.append(
                "Korelasi antar variabel relatif lemah. "
                "Disarankan melakukan feature engineering atau "
                "menambahkan variabel lain untuk meningkatkan kualitas analisis."
            )

    if not recommendations:
        recommendations.append(
            "Tidak terdapat rekomendasi khusus. "
            "Dataset sudah berada dalam kondisi baik."
        )

    return recommendations