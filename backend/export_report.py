"""
export_report.py
================
Modul untuk ekspor laporan: PDF, HTML, Excel/CSV.
"""

import pandas as pd
import os
from datetime import datetime

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "outputs")


def export_to_csv(df: pd.DataFrame, filename: str = None) -> str:
    """Ekspor DataFrame ke Excel."""
    os.makedirs(os.path.join(OUTPUT_DIR, "exported_files"), exist_ok=True)
    if filename is None:
        filename = f"export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    path = os.path.join(OUTPUT_DIR, "exported_files", filename)
    df.to_excel(path, index=False, engine="openpyxl")
    return path


def export_to_excel(df: pd.DataFrame, stats_df: pd.DataFrame = None,
                     filename: str = None) -> str:
    """
    Ekspor DataFrame + statistik ke Excel (multi-sheet).
    """
    os.makedirs(os.path.join(OUTPUT_DIR, "exported_files"), exist_ok=True)
    if filename is None:
        filename = f"report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    path = os.path.join(OUTPUT_DIR, "exported_files", filename)

    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="Data", index=False)
        if stats_df is not None:
            stats_df.to_excel(writer, sheet_name="Descriptive Stats")
    return path


def generate_html_report(df: pd.DataFrame, insights: list,
                          filename: str = None) -> str:
    """
    Buat HTML report ringkas dari dataset dan insights.
    """
    os.makedirs(os.path.join(OUTPUT_DIR, "reports"), exist_ok=True)
    if filename is None:
        filename = f"report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.html"
    path = os.path.join(OUTPUT_DIR, "reports", filename)

    insight_html = "".join(f"<li>{i}</li>" for i in insights)
    html = f"""<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Auto EDA Report</title>
  <style>
    body {{ font-family: 'Segoe UI', sans-serif; background: #f5f0e8; padding: 40px; }}
    h1 {{ color: #1a1a1a; }}
    table {{ border-collapse: collapse; width: 100%; margin-top: 20px; }}
    th {{ background: #1a1a1a; color: #f5e642; padding: 8px; }}
    td {{ border: 1px solid #ddd; padding: 6px; font-size: 13px; }}
    tr:nth-child(even) {{ background: #ede8df; }}
    .insight-box {{ background: white; border-radius: 12px; padding: 20px;
                    margin: 20px 0; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }}
  </style>
</head>
<body>
  <h1>📊 Auto EDA Analytics Report</h1>
  <p>Generated: {datetime.now().strftime('%d %B %Y %H:%M')}</p>
  <p>Dataset: {df.shape[0]} rows × {df.shape[1]} columns</p>

  <div class="insight-box">
    <h2>🔍 Intelligent Insights</h2>
    <ul>{insight_html}</ul>
  </div>

  <h2>📋 Data Preview (First 20 Rows)</h2>
  {df.head(20).to_html(classes='', border=0, index=False)}

  <h2>📈 Descriptive Statistics</h2>
  {df.describe().T.to_html(classes='', border=0)}
</body>
</html>"""

    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    return path