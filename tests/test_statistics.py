"""
test_statistics.py — Unit test untuk modul statistik deskriptif.
"""
import pytest
import pandas as pd
import numpy as np
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.descriptive_stats import calc_numeric_stats, get_all_numeric_stats
from backend.categorical_analysis import calc_categorical_stats, get_all_categorical_stats


def test_calc_numeric_stats_basic():
    s = pd.Series([1, 2, 3, 4, 5])
    result = calc_numeric_stats(s)
    assert result["mean"] == 3.0
    assert result["median"] == 3.0
    assert result["min"] == 1.0
    assert result["max"] == 5.0
    assert result["missing_count"] == 0


def test_calc_numeric_stats_with_missing():
    s = pd.Series([1, 2, None, 4, None])
    result = calc_numeric_stats(s)
    assert result["missing_count"] == 2
    assert result["missing_pct"] == 40.0


def test_calc_categorical_stats():
    s = pd.Series(["A", "B", "A", "A", None])
    result = calc_categorical_stats(s)
    assert result["unique_categories"] == 2
    assert result["mode"] == "A"
    assert result["mode_frequency"] == 3
    assert result["missing_count"] == 1


def test_get_all_numeric_stats():
    df = pd.DataFrame({"x": [1.0, 2.0, 3.0], "y": [10.0, 20.0, 30.0]})
    stats = get_all_numeric_stats(df)
    assert "x" in stats.index
    assert "y" in stats.index
    assert float(stats.loc["x", "mean"]) == 2.0
