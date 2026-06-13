# Auto EDA Analytics Dashboard
**SD-1306 Data Science Programming — Final Exam Mini Project**

Lecturer: Bakti Siregar, M.Sc.  
Institut Teknologi Sains Bandung (ITSB)

---

## Deskripsi
Platform Intelligent Data Analytics berbasis web yang mampu melakukan eksplorasi data otomatis (Auto EDA), analisis statistik lanjutan, visualisasi interaktif, dan generasi insight secara otomatis. Terinspirasi dari Tableau dan Microsoft Power BI.

## Fitur Utama
- **Upload File**: Excel (.xlsx), CSV (.csv), Text (.txt) — dengan validasi otomatis
- **Data Preview**: tabel interaktif + deteksi tipe kolom otomatis
- **Data Cleaning**: hapus duplikat, tangani missing values
- **Statistik Deskriptif Lanjutan**: mean, median, std, skewness, kurtosis, normalitas, outlier
- **Statistik Kategorik**: unique, mode, mode frequency, missing values
- **Visualisasi Otomatis**: Histogram, Boxplot, Density, QQ Plot, Violin, Bar, Pie, Pareto, Scatter, Heatmap, Pair Plot, dll.
- **Time Series Analytics**: auto-deteksi kolom datetime, trend line, moving average, rolling mean
- **Intelligent Insight Generator**: insight otomatis berbasis data
- **Reporting**: Download HTML report, Export CSV/Excel

## Cara Menjalankan

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Jalankan Server
```bash
python app.py
```

### 3. Buka Browser
```
http://localhost:5000
```

> **Catatan**: Dashboard juga dapat digunakan secara standalone (tanpa server) dengan membuka `frontend/templates/dashboard.html` langsung di browser — semua logika berjalan di JavaScript.

## Struktur Proyek
```
Auto_EDA_Insight/
├── app.py                    ← Flask entry point
├── requirements.txt
├── README.md
├── data/
│   ├── raw/                  ← File upload masuk di sini
│   ├── processed/
│   └── sample_dataset/
├── backend/
│   ├── data_loader.py        ← Baca file (xlsx, csv, txt)
│   ├── preprocessing.py      ← Cleaning & deteksi tipe kolom
│   ├── descriptive_stats.py  ← Statistik numerik lanjutan
│   ├── categorical_analysis.py ← Statistik kategorik
│   ├── visualization.py      ← Semua fungsi plot
│   ├── time_series.py        ← Analisis time series
│   ├── insight_generator.py  ← Auto insight
│   └── export_report.py      ← Export PDF/HTML/Excel/CSV
├── frontend/
│   ├── templates/
│   │   └── dashboard.html    ← Halaman utama
│   └── static/
│       ├── css/style.css     ← Semua styling
│       └── js/script.js      ← Semua logika frontend
├── outputs/
│   ├── charts/               ← Grafik yang dihasilkan
│   ├── reports/              ← HTML reports
│   └── exported_files/       ← CSV/Excel exports
├── models/
│   └── forecasting_model/
├── docs/
│   └── dashboard_screenshot/
└── tests/
    ├── test_upload.py
    ├── test_statistics.py
    └── test_visualization.py
```

## Tim Pengembang
Kelompok 1 — Kelas A  
Institut Teknologi Sains Bandung
