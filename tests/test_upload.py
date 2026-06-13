"""
test_upload.py — Unit test untuk modul data loading dan upload.
"""
import pytest
import pandas as pd
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.data_loader import load_file, get_dataset_info
from backend.preprocessing import detect_column_types


def test_load_csv(tmp_path):
    """Test membaca file CSV."""
    csv_file = tmp_path / "test.csv"
    csv_file.write_text("name,age,score\nAlice,20,85.5\nBob,22,90.0\n")
    df = load_file(str(csv_file))
    assert df.shape == (2, 3)
    assert list(df.columns) == ["name", "age", "score"]


def test_load_unsupported_format(tmp_path):
    """Test format tidak didukung harus raise ValueError."""
    bad_file = tmp_path / "test.json"
    bad_file.write_text("{}")
    with pytest.raises(ValueError):
        load_file(str(bad_file))


def test_get_dataset_info():
    """Test informasi dataset."""
    df = pd.DataFrame({"a": [1, 2, None], "b": ["x", "y", "z"]})
    info = get_dataset_info(df)
    assert info["rows"] == 3
    assert info["columns"] == 2
    assert info["missing_total"] == 1


def test_detect_column_types():
    """Test deteksi tipe kolom otomatis."""
    df = pd.DataFrame({
        "sales": [100, 200, 300],
        "category": ["A", "B", "C"],
        "date": pd.to_datetime(["2024-01-01", "2024-01-02", "2024-01-03"]),
    })
    types = detect_column_types(df)
    assert types["sales"] == "numeric"
    assert types["category"] == "categorical"
    assert types["date"] == "datetime"
