# ❄️ ESP32 Peltier Cooling Early Warning System

Sistem pemantauan dan kontrol suhu otomatis menggunakan **DHT22 + Peltier + Linear Regression + Firebase + Node.js + Telegram**.

---

## 🏗️ Arsitektur Sistem

```text
     DHT22 Sensor ──────┐
                        ▼
[ESP32 + Peltier] ◄──► Firebase RTDB ──► Node.js Server
                        ▲     │               │
                        │     │     ┌─────────┼─────────┐
                        │     │     ▼         ▼         ▼
                        │     │  Linear     Alert     Socket.IO
                        │     │ Regression  System   (Real-time)
                        │     │  (Trend)      │         │
                        │     │               ▼         ▼
                        │     └────────► Telegram   Dashboard Web
                        │                  Bot     (Grafik + Kontrol)
                        └───────────────────────────────┘
                                     Kontrol Setpoint
```

---

## ⚙️ Cara Kerja Linear Regression & Sistem EWS

Sistem menggunakan Algoritma Linear Regression untuk memprediksi suhu masa depan berdasarkan data historis:

**Alur:**
1. Ambil 30 titik data historis (suhu) terakhir dari Firebase.
2. Train model untuk mendapatkan nilai slope (tren) & intercept.
3. Prediksi suhu N menit ke depan (default: 10 menit).
4. Jika prediksi atau suhu aktual melebihi threshold (batas aman), sistem akan:
   - Klasifikasi level bahaya (WARNING, DANGER, CRITICAL)
   - Kirim notifikasi Telegram sesuai rate limit.
   - Update status visual di Dashboard secara real-time.

---

## 🚦 Level Bahaya (Threshold)

Diatur melalui `.env` atau `src/alertSystem.js`:

| Level    | Kondisi                       | Notifikasi Telegram |
|----------|-------------------------------|---------------------|
| NORMAL   | Suhu sesuai target/aman       | -                   |
| WASPADA  | Suhu mendekati ambang batas   | Maks 1x / 30 menit  |
| BAHAYA   | Suhu melebihi batas bahaya    | Maks 1x / 15 menit  |
| KRITIS   | Suhu ekstrem / darurat        | Maks 1x / 5 menit   |

---

## 🚀 Instalasi & Jalankan

### 1. Clone Project
```bash
git clone <repo-url>
cd linear-regresion
npm install
```

### 2. Setup Environment Variables
Copy file example:
```bash
cp .env.example .env
```
Isi `.env` dengan kredensial Firebase dan Telegram:
```env
# Firebase
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY_ID=your-key-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com
FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com

# Sensor & Threshold
SENSOR_ID=esp32_01
PREDICTION_MINUTES=10

# Telegram Bot
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_CHAT_ID=your-chat-id
```

### 3. Jalankan Server

**Mode Demo (Simulasi Data):**
Berguna jika belum ada hardware ESP32.
```bash
USE_MOCK=true node src/server.js
```

**Mode Produksi (Hardware Asli):**
```bash
node src/server.js
```

**Development Mode (Auto-Reload):**
```bash
npm run dev
```

Dashboard dapat diakses di: **`http://localhost:3000`**

---

## 📡 Struktur Data Firebase

### 1. Data Sensor (`/devices/{device_id}`)
```json
// Path: /devices/esp32_01/latest
{
  "device_id": "esp32_01",
  "temperature": 27.5,
  "temperature_raw": 30.0,
  "temperature_offset": -2.5,
  "humidity": 65.2,
  "peltier_status": "ON",
  "auto_mode": true,
  "target_temperature": 28.0,
  "timestamp": 1710000000000
}
```

### 2. Kontrol Aktuator (`/control/{device_id}`)
```json
// Path: /control/esp32_01
{
  "target_temperature": 28.0,
  "auto_mode": true
}
```

---

## 🔌 API Endpoints

| Method | Endpoint               | Deskripsi                                    |
|--------|------------------------|----------------------------------------------|
| GET    | `/`                    | Buka Dashboard UI                            |
| GET    | `/api/status`          | Status server, mode (demo/prod), & device ID |
| GET    | `/api/telegram-status` | Status dan rate limit notifikasi Telegram    |
| GET    | `/api/latest`          | Data sensor & prediksi terkini               |
| GET    | `/api/alerts`          | Riwayat notifikasi sistem                    |
| GET    | `/api/control`         | Ambil status setpoint dan mode kontrol       |
| POST   | `/api/control`         | Ubah setpoint target suhu / auto mode        |
| POST   | `/api/mock/trend`      | Ubah tren simulasi (khusus `USE_MOCK=true`)  |
| POST   | `/api/analyze`         | Trigger analisis manual                      |
| POST   | `/api/predict`         | Cek prediksi custom `N` menit ke depan       |

---

## 📁 Struktur File

```
linear-regresion/
├── src/
│   ├── server.js           # Server utama (Express + Socket.IO)
│   ├── linearRegression.js # Algoritma Prediksi Suhu
│   ├── alertSystem.js      # Klasifikasi bahaya & threshold
│   ├── firebaseService.js  # Interaksi Firebase (CRUD & Mock)
│   └── telegramService.js  # Notifikasi Telegram & Rate Limiting
├── public/
│   └── index.html          # Dashboard Web UI
├── prototype_server.ino    # Kode ESP32 (Arduino IDE)
├── package.json
└── .env.example
```
