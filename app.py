"""
app.py
======
Entry point — Flask web server untuk Auto EDA Analytics Dashboard.
SD-1306 Data Science Programming | Kelompok 1

Cara menjalankan:
    pip install -r requirements.txt
    python app.py
Buka browser: http://localhost:5000
"""

from flask import Flask, render_template, request, jsonify, send_file
import pandas as pd
import os
import json
from datetime import datetime

# Backend modules
from backend.data_loader import load_file, get_dataset_info
from backend.preprocessing import detect_column_types, remove_duplicates, handle_missing_values
from backend.descriptive_stats import get_all_numeric_stats
from backend.categorical_analysis import get_all_categorical_stats, get_top_categories
from backend.visualization import (
    plot_histogram, plot_boxplot, plot_density, plot_qq, plot_violin,
    plot_bar_chart, plot_pie_chart, plot_pareto_chart,
    plot_scatter, plot_correlation_heatmap, plot_pair_plot, plot_regression,
    plot_boxplot_by_category, plot_grouped_bar
)
from backend.time_series import detect_datetime_columns, prepare_time_series, plot_time_series
from backend.insight_generator import generate_insights
from backend.export_report import export_to_csv, export_to_excel, generate_html_report

app = Flask(
    __name__,
    template_folder="frontend/templates",
    static_folder="frontend/static"
)

UPLOAD_FOLDER = os.path.join("data", "raw")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB

# Global state (per-session sederhana; gunakan session/DB untuk multi-user)
state = {"df": None, "file_info": {}, "col_types": {}}


@app.route("/")
def index():
    return render_template("dashboard.html")


@app.route("/upload", methods=["POST"])
def upload():
    """Terima file upload, baca data, deteksi tipe kolom."""
    if "file" not in request.files:
        return jsonify({"error": "Tidak ada file yang dikirim."}), 400

    f = request.files["file"]
    if f.filename == "":
        return jsonify({"error": "Nama file kosong."}), 400

    ext = os.path.splitext(f.filename)[-1].lower()
    if ext not in [".xlsx", ".xls", ".csv", ".txt"]:
        return jsonify({"error": f"Format tidak didukung: {ext}"}), 400

    save_path = os.path.join(UPLOAD_FOLDER, f.filename)
    f.save(save_path)

    try:
        df = load_file(save_path)
        state["df"] = df
        state["col_types"] = detect_column_types(df)
        state["file_info"] = get_dataset_info(df, save_path)
        return jsonify({
            "success": True,
            "file_info": state["file_info"],
            "columns": list(df.columns),
            "col_types": state["col_types"],
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/preview")
def preview():
    """Kirim data preview (JSON)."""
    df = state.get("df")
    if df is None:
        return jsonify({"error": "Belum ada data."}), 400

    page = int(request.args.get("page", 1))
    page_size = int(request.args.get("page_size", 20))
    start = (page - 1) * page_size
    end = start + page_size

    data_slice = df.iloc[start:end].fillna("").to_dict(orient="records")
    return jsonify({
        "data": data_slice,
        "columns": list(df.columns),
        "total_rows": len(df),
        "total_pages": -(-len(df) // page_size),
        "col_types": state["col_types"],
    })


@app.route("/stats/numerical")
def stats_numerical():
    df = state.get("df")
    if df is None:
        return jsonify({"error": "Belum ada data."}), 400
    result = get_all_numeric_stats(df)
    return jsonify(result.reset_index().rename(columns={"index": "column"}).to_dict(orient="records"))


@app.route("/stats/categorical")
def stats_categorical():
    df = state.get("df")
    if df is None:
        return jsonify({"error": "Belum ada data."}), 400
    result = get_all_categorical_stats(df)
    return jsonify(result.reset_index().rename(columns={"index": "column"}).to_dict(orient="records"))


@app.route("/insights")
def insights():
    df = state.get("df")
    if df is None:
        return jsonify({"error": "Belum ada data."}), 400
    from backend.insight_generator import generate_insights, generate_recommendations
    return jsonify({
        "insights": generate_insights(df),
        "recommendations": generate_recommendations(df)
    })


@app.route("/insights/summary")
def insights_summary():
    df = state.get("df")
    if df is None:
        return jsonify({"error": "Belum ada data."}), 400
    
    import numpy as np
    num_df = df.select_dtypes(include=[np.number])
    cat_df = df.select_dtypes(include=["object", "category"])
    
    # Statistik numerik
    num_stats = []
    for col in num_df.columns:
        clean = num_df[col].dropna()
        q1, q3 = clean.quantile(0.25), clean.quantile(0.75)
        iqr = q3 - q1
        outliers = int(((clean < q1-1.5*iqr) | (clean > q3+1.5*iqr)).sum())
        skewness = float(clean.skew())
        num_stats.append({
            "col": col,
            "mean": float(clean.mean()),
            "std": float(clean.std()),
            "skewness": round(skewness, 3),
            "outliers": outliers,
            "distribusi": "normal" if abs(skewness) < 0.5 else ("right skewed" if skewness > 0 else "left skewed")
        })
    
    # Statistik kategorik
    cat_stats = []
    for col in cat_df.columns:
        vc = df[col].value_counts()
        cat_stats.append({
            "col": col,
            "unique": int(len(vc)),
            "top": str(vc.index[0]),
            "top_pct": round(float(vc.iloc[0] / len(df) * 100), 1),
            "imbalanced": float(vc.iloc[0] / len(df) * 100) >= 70
        })
    
    # Korelasi terkuat
    corr_result = {"c1": "-", "c2": "-", "r": 0}
    cols = num_df.columns.tolist()
    for i in range(len(cols)):
        for j in range(i+1, len(cols)):
            r = abs(float(num_df[cols[i]].corr(num_df[cols[j]])))
            if r > corr_result["r"]:
                corr_result = {"c1": cols[i], "c2": cols[j], "r": round(r, 3)}
    
    # Rekomendasi otomatis
    rekomendasi = []
    skewed = [s["col"] for s in num_stats if abs(s["skewness"]) >= 0.5]
    if skewed:
        rekomendasi.append(f"Variabel {', '.join(skewed)} memiliki distribusi skewed. Disarankan transformasi log atau normalisasi sebelum modeling.")
    
    outlier_cols = [s["col"] for s in num_stats if s["outliers"] > 0]
    if outlier_cols:
        rekomendasi.append(f"Variabel {', '.join(outlier_cols)} masih memiliki outlier. Pertimbangkan winsorizing atau robust scaling untuk machine learning.")
    
    imbalanced = [c["col"] for c in cat_stats if c["imbalanced"]]
    if imbalanced:
        rekomendasi.append(f"Variabel {', '.join(imbalanced)} memiliki kategori dominan >= 70%. Pertimbangkan balancing data untuk klasifikasi.")
    
    if df.isnull().sum().sum() == 0 and df.duplicated().sum() == 0:
        rekomendasi.append("Dataset bersih dari missing values dan duplikat, siap untuk analisis lanjutan.")
    
    if corr_result["r"] < 0.3:
        rekomendasi.append("Korelasi antar variabel lemah. Disarankan feature engineering atau penambahan variabel.")
    
    return jsonify({
        "num_stats": num_stats,
        "cat_stats": cat_stats,
        "korelasi_terkuat": corr_result,
        "rekomendasi": rekomendasi,
        "total_rows": len(df),
        "missing_total": int(df.isnull().sum().sum())
    })


@app.route("/export/csv")
def export_csv():
    df = state.get("df")
    if df is None:
        return jsonify({"error": "Belum ada data."}), 400
    path = export_to_csv(df)
    return send_file(path, as_attachment=True, mimetype="text/csv")


@app.route("/export/excel")
def export_excel():
    df = state.get("df")
    if df is None:
        return jsonify({"error": "Belum ada data."}), 400
    stats_df = get_all_numeric_stats(df)
    path = export_to_excel(df, stats_df)
    return send_file(path, as_attachment=True, mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.route("/sample-data")
def get_sample_data():
    """Return sample dataset as JSON."""
    sample_path = os.path.join("data", "sample_dataset", "sample_sales.csv")
    if not os.path.exists(sample_path):
        return jsonify({"error": "Sample data tidak ditemukan."}), 404
    try:
        df = pd.read_csv(sample_path)
        return jsonify({
            "success": True,
            "data": df.fillna("").to_dict(orient="records"),
            "columns": list(df.columns),
            "fileName": "sample_sales.csv",
            "rows": len(df)
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500



def export_html():
    df = state.get("df")
    if df is None:
        return jsonify({"error": "Belum ada data."}), 400
    ins = generate_insights(df)
    path = generate_html_report(df, ins)
    return send_file(path, as_attachment=True, mimetype="text/html")

@app.route("/save-cleaned", methods=["POST"])
def save_cleaned():
    """Simpan data cleaned ke folder data/processed/"""
    try:
        body = request.get_json()
        data = body.get("data", [])
        filename = body.get("filename", "cleaned_data.csv")
        if not data:
            return jsonify({"error": "Data kosong."}), 400
        df = pd.DataFrame(data)
        processed_dir = os.path.join("data", "processed")
        os.makedirs(processed_dir, exist_ok=True)
        base, ext = os.path.splitext(filename)
        save_name = f"{base}_clean{ext}" if ext else f"{base}_clean.csv"
        save_path = os.path.join(processed_dir, save_name)
        df.to_csv(save_path, index=False)
        return jsonify({"success": True, "saved_to": save_path})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/save-export", methods=["POST"])
def save_export():
    """Simpan file export (csv/excel/pdf-html) ke data/processed/"""
    try:
        content_type = request.content_type or ""

        processed_dir = os.path.join("data", "processed")
        os.makedirs(processed_dir, exist_ok=True)

        if "application/json" in content_type:
            # CSV export
            body = request.get_json()
            data = body.get("data", [])
            filename = body.get("filename", "export.csv")
            if not data:
                return jsonify({"error": "Data kosong."}), 400
            df = pd.DataFrame(data)
            save_path = os.path.join(processed_dir, filename)
            df.to_csv(save_path, index=False, encoding="utf-8-sig")
            return jsonify({"success": True, "saved_to": save_path})

        elif "multipart/form-data" in content_type:
            # Excel atau HTML/PDF
            file = request.files.get("file")
            filename = request.form.get("filename", "export.xlsx")
            if not file:
                return jsonify({"error": "File tidak ditemukan."}), 400
            save_path = os.path.join(processed_dir, filename)
            file.save(save_path)
            return jsonify({"success": True, "saved_to": save_path})

        else:
            return jsonify({"error": "Content-type tidak dikenali."}), 400

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/save-viz-png', methods=['POST'])
def save_viz_png():
    try:
        file = request.files.get('file')
        filename = request.form.get('filename', 'viz_chart.png')
        if not file:
            return jsonify({'error': 'No file'}), 400
        # Pastikan hanya .png
        if not filename.lower().endswith('.png'):
            filename += '.png'
        save_dir = os.path.join('data', 'visualisasi_png')
        os.makedirs(save_dir, exist_ok=True)
        save_path = os.path.join(save_dir, filename)
        file.save(save_path)
        return jsonify({'success': True, 'path': save_path})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)


