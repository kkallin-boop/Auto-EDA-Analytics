"""
visualization.py
================
Modul untuk menghasilkan visualisasi otomatis menggunakan Matplotlib & Seaborn.
Mendukung: Numerical, Categorical, Bivariate/Multivariate, Categorical vs Numerical.
"""

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
from scipy import stats as scipy_stats
import os

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "outputs", "charts")
os.makedirs(OUTPUT_DIR, exist_ok=True)

PALETTE = ["#f5e642", "#f4aecf", "#b8d96e", "#a8cdef", "#f4c4a0",
           "#e85d5d", "#4a9ee8", "#6dbf67", "#f5a623", "#9b59b6"]


def _save_fig(filename: str) -> str:
    path = os.path.join(OUTPUT_DIR, filename)
    plt.savefig(path, bbox_inches="tight", dpi=150, facecolor="white")
    plt.close()
    return path


# ── NUMERICAL VISUALIZATIONS ────────────────────────────────────────────────

def plot_histogram(df: pd.DataFrame, col: str) -> str:
    """Histogram dengan KDE overlay."""
    fig, ax = plt.subplots(figsize=(8, 5))
    clean = df[col].dropna()
    ax.hist(clean, bins="auto", color=PALETTE[0], edgecolor="white", alpha=0.85)
    ax2 = ax.twinx()
    clean.plot.kde(ax=ax2, color="#1a1a1a", linewidth=2)
    ax2.set_ylabel("Density")
    ax.set_title(f"Histogram — {col}", fontsize=14, fontweight="bold")
    ax.set_xlabel(col)
    return _save_fig(f"hist_{col}.png")


def plot_boxplot(df: pd.DataFrame, col: str) -> str:
    """Boxplot untuk deteksi outlier."""
    fig, ax = plt.subplots(figsize=(8, 4))
    ax.boxplot(df[col].dropna(), vert=False, patch_artist=True,
               boxprops=dict(facecolor=PALETTE[2], color="#333"),
               medianprops=dict(color="#e85d5d", linewidth=2))
    ax.set_title(f"Boxplot — {col}", fontsize=14, fontweight="bold")
    ax.set_xlabel(col)
    return _save_fig(f"box_{col}.png")


def plot_density(df: pd.DataFrame, col: str) -> str:
    """Density/KDE plot."""
    fig, ax = plt.subplots(figsize=(8, 5))
    df[col].dropna().plot.kde(ax=ax, color=PALETTE[3], linewidth=2.5)
    ax.fill_between(ax.lines[0].get_xdata(), ax.lines[0].get_ydata(),
                    alpha=0.3, color=PALETTE[3])
    ax.set_title(f"Density Plot — {col}", fontsize=14, fontweight="bold")
    return _save_fig(f"density_{col}.png")


def plot_qq(df: pd.DataFrame, col: str) -> str:
    """QQ Plot untuk uji normalitas visual."""
    fig, ax = plt.subplots(figsize=(6, 6))
    clean = df[col].dropna()
    scipy_stats.probplot(clean, plot=ax)
    ax.get_lines()[0].set(markerfacecolor=PALETTE[1], alpha=0.6)
    ax.get_lines()[1].set(color="#e85d5d")
    ax.set_title(f"QQ Plot — {col}", fontsize=14, fontweight="bold")
    return _save_fig(f"qq_{col}.png")


def plot_violin(df: pd.DataFrame, col: str) -> str:
    """Violin plot."""
    fig, ax = plt.subplots(figsize=(8, 5))
    sns.violinplot(y=df[col].dropna(), ax=ax, color=PALETTE[4], inner="box")
    ax.set_title(f"Violin Plot — {col}", fontsize=14, fontweight="bold")
    return _save_fig(f"violin_{col}.png")


# ── CATEGORICAL VISUALIZATIONS ──────────────────────────────────────────────

def plot_bar_chart(df: pd.DataFrame, col: str, top_n: int = 15) -> str:
    """Bar chart frekuensi kategori."""
    vc = df[col].value_counts().head(top_n)
    fig, ax = plt.subplots(figsize=(9, 5))
    vc.plot.bar(ax=ax, color=PALETTE[:len(vc)], edgecolor="white")
    ax.set_title(f"Bar Chart — {col}", fontsize=14, fontweight="bold")
    ax.set_xlabel(col)
    ax.set_ylabel("Count")
    plt.xticks(rotation=30, ha="right")
    return _save_fig(f"bar_{col}.png")


def plot_pie_chart(df: pd.DataFrame, col: str, top_n: int = 8) -> str:
    """Pie chart proporsi kategori."""
    vc = df[col].value_counts().head(top_n)
    fig, ax = plt.subplots(figsize=(7, 7))
    ax.pie(vc, labels=vc.index, autopct="%1.1f%%",
           colors=PALETTE[:len(vc)], startangle=90)
    ax.set_title(f"Pie Chart — {col}", fontsize=14, fontweight="bold")
    return _save_fig(f"pie_{col}.png")


def plot_pareto_chart(df: pd.DataFrame, col: str, top_n: int = 15) -> str:
    """Pareto chart (bar + garis kumulatif)."""
    vc = df[col].value_counts().head(top_n)
    cumulative = vc.cumsum() / vc.sum() * 100
    fig, ax1 = plt.subplots(figsize=(10, 5))
    ax1.bar(range(len(vc)), vc, color=PALETTE[0], edgecolor="white")
    ax1.set_xticks(range(len(vc)))
    ax1.set_xticklabels(vc.index, rotation=30, ha="right")
    ax2 = ax1.twinx()
    ax2.plot(range(len(vc)), cumulative, "o-", color="#e85d5d", linewidth=2)
    ax2.set_ylabel("Cumulative %")
    ax2.axhline(80, color="#999", linestyle="--", linewidth=1)
    ax1.set_title(f"Pareto Chart — {col}", fontsize=14, fontweight="bold")
    return _save_fig(f"pareto_{col}.png")


# ── BIVARIATE & MULTIVARIATE ─────────────────────────────────────────────────

def plot_scatter(df: pd.DataFrame, col_x: str, col_y: str) -> str:
    """Scatter plot dua variabel numerik."""
    fig, ax = plt.subplots(figsize=(8, 6))
    ax.scatter(df[col_x], df[col_y], alpha=0.5, color=PALETTE[2], edgecolors="white", s=40)
    ax.set_xlabel(col_x)
    ax.set_ylabel(col_y)
    ax.set_title(f"Scatter Plot — {col_x} vs {col_y}", fontsize=13, fontweight="bold")
    return _save_fig(f"scatter_{col_x}_{col_y}.png")


def plot_correlation_heatmap(df: pd.DataFrame) -> str:
    """Correlation heatmap semua variabel numerik."""
    num_df = df.select_dtypes(include=[np.number])
    corr = num_df.corr()
    fig, ax = plt.subplots(figsize=(max(8, len(corr)), max(6, len(corr) - 1)))
    sns.heatmap(corr, annot=True, fmt=".2f", cmap="RdYlGn",
                vmin=-1, vmax=1, ax=ax, linewidths=0.5)
    ax.set_title("Correlation Heatmap", fontsize=14, fontweight="bold")
    return _save_fig("correlation_heatmap.png")


def plot_pair_plot(df: pd.DataFrame) -> str:
    """Pair plot (max 6 kolom numerik untuk performa)."""
    num_cols = df.select_dtypes(include=[np.number]).columns[:6]
    g = sns.pairplot(df[num_cols].dropna(), plot_kws={"alpha": 0.4, "color": PALETTE[0]})
    g.fig.suptitle("Pair Plot", y=1.02, fontsize=14, fontweight="bold")
    path = os.path.join(OUTPUT_DIR, "pair_plot.png")
    g.fig.savefig(path, bbox_inches="tight", dpi=120, facecolor="white")
    plt.close()
    return path


def plot_regression(df: pd.DataFrame, col_x: str, col_y: str) -> str:
    """Regression plot (scatter + garis regresi)."""
    fig, ax = plt.subplots(figsize=(8, 6))
    sns.regplot(data=df, x=col_x, y=col_y, ax=ax,
                scatter_kws={"alpha": 0.5, "color": PALETTE[3]},
                line_kws={"color": "#e85d5d", "linewidth": 2})
    ax.set_title(f"Regression Plot — {col_x} vs {col_y}", fontsize=13, fontweight="bold")
    return _save_fig(f"regression_{col_x}_{col_y}.png")


# ── CATEGORICAL vs NUMERICAL ─────────────────────────────────────────────────

def plot_boxplot_by_category(df: pd.DataFrame, cat_col: str, num_col: str) -> str:
    """Boxplot numerik per kategori."""
    fig, ax = plt.subplots(figsize=(10, 5))
    groups = [grp[num_col].dropna().values
              for _, grp in df.groupby(cat_col)]
    labels = df[cat_col].unique()[:15]
    ax.boxplot(groups, labels=labels, patch_artist=True,
               boxprops=dict(facecolor=PALETTE[1], alpha=0.7))
    ax.set_title(f"Boxplot {num_col} by {cat_col}", fontsize=13, fontweight="bold")
    plt.xticks(rotation=30, ha="right")
    return _save_fig(f"boxcat_{cat_col}_{num_col}.png")


def plot_grouped_bar(df: pd.DataFrame, cat_col: str, num_col: str) -> str:
    """Grouped bar chart: rata-rata numerik per kategori."""
    agg = df.groupby(cat_col)[num_col].mean().sort_values(ascending=False).head(15)
    fig, ax = plt.subplots(figsize=(10, 5))
    agg.plot.bar(ax=ax, color=PALETTE[:len(agg)], edgecolor="white")
    ax.set_title(f"Mean {num_col} by {cat_col}", fontsize=13, fontweight="bold")
    ax.set_ylabel(f"Mean {num_col}")
    plt.xticks(rotation=30, ha="right")
    return _save_fig(f"groupbar_{cat_col}_{num_col}.png")
