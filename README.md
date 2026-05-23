# 🔥 Solar Panel Fire Early Warning System

Sistem deteksi dini kebakaran panel surya menggunakan **DHT22 + Linear Regression + Firebase + Node.js**.

---

## 🏗️ Arsitektur Sistem

```
DHT22 Sensor
    │
    ▼
Firebase Realtime DB ──► Node.js Server
                              │
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
            Linear     Alert      Socket.IO
           Regression  System    (Real-time)
                    └─────────┴─────────┘
                                  │
                                  ▼
                           Dashboard Web
                        (Grafik + Notifikasi)
```

---

## ⚙️ Cara Kerja Linear Regression

**Rumus:**
```
y = mx + b

m (slope)     = (n·Σxy - Σx·Σy) / (n·Σx² - (Σx)²)
b (intercept) = (Σy - m·Σx) / n

x = waktu dalam menit (dinormalisasi dari 0)
y = suhu dalam °C
```

**Alur:**
1. Ambil 30 data historis dari Firebase
2. Train model → hitung slope & intercept
3. Prediksi suhu 10 menit ke depan
4. Jika prediksi > threshold → kirim peringatan

---

## 🚦 Level Bahaya

| Level    | Suhu      | Aksi                          |
|----------|-----------|-------------------------------|
| NORMAL   | < 45°C    | Monitor rutin                 |
| WASPADA  | 45–60°C   | Periksa ventilasi             |
| BAHAYA   | 60–75°C   | Periksa segera                |
| KRITIS   | > 75°C    | Matikan sistem, hubungi DAMKAR|

---

## 🚀 Instalasi & Jalankan

### 1. Clone / copy project ini
```bash
cd solar-fire-ews
npm install
```

### 2. Setup environment variables
```bash
cp .env.example .env
# Edit .env dengan credential Firebase kamu
```

### 3. Isi .env dengan data Firebase
```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY_ID=your-key-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com
FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com
```

### 4. Jalankan

**Mode Demo (tanpa hardware, data simulasi):**
```bash
USE_MOCK=true node src/server.js
```

**Mode Produksi (pakai Firebase real):**
```bash
node src/server.js
```

**Development dengan auto-reload:**
```bash
npm run dev
```

### 5. Buka Dashboard
```
http://localhost:3000
```

---

## 📡 Struktur Data Firebase

Data dari ESP32/Arduino yang dikirim ke Firebase harus mengikuti format ini:

```json
// Path: /sensors/panel_01/current
{
  "temperature": 52.3,
  "humidity": 35.2,
  "timestamp": 1710000000000
}

// Path: /sensors/panel_01/history/{push_id}
{
  "temperature": 52.3,
  "humidity": 35.2,
  "timestamp": 1710000000000
}
```

### Kode Arduino/ESP32 untuk kirim data:
```cpp
#include <DHT.h>
#include <FirebaseESP32.h>

#define DHTPIN 4
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);

void sendToFirebase() {
  float temp = dht.readTemperature();
  float hum  = dht.readHumidity();
  long  ts   = millis(); // Atau gunakan NTP timestamp

  // Kirim ke current (untuk real-time)
  Firebase.setFloat(fbdo, "/sensors/panel_01/current/temperature", temp);
  Firebase.setFloat(fbdo, "/sensors/panel_01/current/humidity", hum);
  Firebase.setInt(fbdo,   "/sensors/panel_01/current/timestamp", ts);

  // Push ke history (untuk training model)
  FirebaseJson json;
  json.set("temperature", temp);
  json.set("humidity", hum);
  json.set("timestamp", ts);
  Firebase.pushJSON(fbdo, "/sensors/panel_01/history", json);
}
```

---

## 🔌 API Endpoints

| Method | Endpoint        | Deskripsi                          |
|--------|-----------------|------------------------------------|
| GET    | `/`             | Dashboard web                      |
| GET    | `/api/status`   | Status sistem & mode               |
| GET    | `/api/latest`   | Data sensor + prediksi terkini     |
| GET    | `/api/alerts`   | Riwayat semua notifikasi           |
| POST   | `/api/analyze`  | Trigger manual analisis            |
| POST   | `/api/predict`  | Prediksi custom (body: {minutes})  |

---

## 📁 Struktur File

```
solar-fire-ews/
├── src/
│   ├── server.js           # Main server (Express + Socket.IO)
│   ├── linearRegression.js # Algoritma Linear Regression
│   ├── alertSystem.js      # Klasifikasi bahaya & notifikasi
│   └── firebaseService.js  # Firebase CRUD + mock data
├── public/
│   └── index.html          # Dashboard real-time
├── .env.example
├── package.json
└── README.md
```

---

## 🔧 Konfigurasi Threshold

Edit di `.env` atau langsung di `src/alertSystem.js`:

```env
TEMP_WARNING=55        # °C mulai waspada
TEMP_DANGER=70         # °C bahaya
HUMIDITY_MIN=10        # % terlalu kering
PREDICTION_MINUTES=10  # Prediksi berapa menit ke depan
```
