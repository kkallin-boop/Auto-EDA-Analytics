"""
test_visualization.py — Unit test untuk modul visualisasi.
"""
import pytest
import pandas as pd
import numpy as np
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.visualization import plot_histogram, plot_bar_chart, plot_correlation_heatmap


@pytest.fixture
def sample_df():
    np.random.seed(42)
    return pd.DataFrame({
        "sales": np.random.normal(500, 100, 100),
        "profit": np.random.normal(100, 30, 100),
        "category": np.random.choice(["A", "B", "C"], 100),
    })


def test_plot_histogram_creates_file(sample_df, tmp_path, monkeypatch):
    """Test bahwa histogram menghasilkan file PNG."""
    import backend.visualization as viz_module
    monkeypatch.setattr(viz_module, "OUTPUT_DIR", str(tmp_path))
    path = plot_histogram(sample_df, "sales")
    assert os.path.exists(path)
    assert path.endswith(".png")


def test_plot_bar_chart_creates_file(sample_df, tmp_path, monkeypatch):
    """Test bahwa bar chart menghasilkan file PNG."""
    import backend.visualization as viz_module
    monkeypatch.setattr(viz_module, "OUTPUT_DIR", str(tmp_path))
    path = plot_bar_chart(sample_df, "category")
    assert os.path.exists(path)


def test_correlation_heatmap(sample_df, tmp_path, monkeypatch):
    """Test correlation heatmap."""
    import backend.visualization as viz_module
    monkeypatch.setattr(viz_module, "OUTPUT_DIR", str(tmp_path))
    path = plot_correlation_heatmap(sample_df)
    assert os.path.exists(path)
