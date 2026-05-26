#include <WiFi.h>
#include <WiFiManager.h>
#include <DHT.h>
#include <Firebase_ESP_Client.h>

#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

// =====================================================
// KREDENSIAL FIREBASE & KONFIGURASI HARDWARE
// =====================================================
#define API_KEY         "AIzaSyDZRFlniSVH1JSF7laypnVyNcGrLieYcHI"
#define DATABASE_URL    "https://prototype-serveresp32-default-rtdb.asia-southeast1.firebasedatabase.app"
#define DEVICE_ID       "esp32_01"

#define DHTPIN          4
#define DHTTYPE         DHT22
#define PELTIER_PIN     26

// Relay aktif LOW: LOW = ON, HIGH = OFF
#define RELAY_ACTIVE_LOW true

// Kalibrasi suhu DHT22: hasil bacaan dikurangi 2°C
const float DHT_TEMP_OFFSET = -2.5;

DHT dht(DHTPIN, DHTTYPE);

// =====================================================
// VARIABEL & OBJEK GLOBAL
// =====================================================
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

bool signupOK = false;

// Variabel Kendali Utama
float targetTemperature = 28.0;
float hysteresis = 1.5;
bool autoMode = true;
bool peltierState = false;

// Variabel Waktu (Millis non-blocking)
unsigned long lastSend = 0;
const unsigned long sendInterval = 10000;
unsigned long lastSetpointRead = 0;
const unsigned long setpointInterval = 5000;

// Variabel Khusus Tracking Auto-Reconnect WiFi
unsigned long lostConnectionMillis = 0;
const unsigned long reconnectThreshold = 30000;

// =====================================================
// HELPER: KONTROL RELAY ACTIVE LOW
// =====================================================
void setRelayPeltier(bool on) {
  peltierState = on;

  if (RELAY_ACTIVE_LOW) {
    digitalWrite(PELTIER_PIN, on ? LOW : HIGH);
  } else {
    digitalWrite(PELTIER_PIN, on ? HIGH : LOW);
  }
}

// =====================================================
// FUNGSI 1: LOGIKA OTOMATISASI PELTIER
// =====================================================
void controlPeltier(float currentTemp) {
  if (!autoMode) return;

  if (currentTemp >= targetTemperature && !peltierState) {
    setRelayPeltier(true);
    Serial.println("[AKTUATOR] Suhu tinggi! Relay aktif LOW -> Peltier ON");
  }
  else if (currentTemp <= (targetTemperature - hysteresis) && peltierState) {
    setRelayPeltier(false);
    Serial.println("[AKTUATOR] Suhu aman. Relay OFF -> Peltier OFF");
  }
}

// =====================================================
// FUNGSI 2: BACA SETPOINT / KONTROL DARI FIREBASE
// =====================================================
void readControlFromFirebase() {
  String basePath = "/control/" + String(DEVICE_ID);

  if (Firebase.RTDB.getFloat(&fbdo, (basePath + "/target_temperature").c_str())) {
    if (fbdo.dataType() == "float" || fbdo.dataType() == "int") {
      targetTemperature = fbdo.floatData();
      Serial.print("[FIREBASE] Setpoint Suhu Baru: ");
      Serial.println(targetTemperature);
    }
  } else {
    Serial.print("[FIREBASE] Gagal baca target_temperature: ");
    Serial.println(fbdo.errorReason());
  }

  if (Firebase.RTDB.getBool(&fbdo, (basePath + "/auto_mode").c_str())) {
    autoMode = fbdo.boolData();
    Serial.print("[FIREBASE] Status Auto Mode: ");
    Serial.println(autoMode ? "AKTIF" : "MATI");
  } else {
    Serial.print("[FIREBASE] Gagal baca auto_mode: ");
    Serial.println(fbdo.errorReason());
  }
}

// =====================================================
// FUNGSI 3: KIRIM DATA SENSOR & STATUS KE FIREBASE
// =====================================================
void sendDataToFirebase(float rawTemperature, float correctedTemperature, float humidity) {
  String baseDevicePath = "/devices/" + String(DEVICE_ID);
  FirebaseJson json;

  json.set("device_id", DEVICE_ID);
  json.set("temperature_raw", rawTemperature);
  json.set("temperature", correctedTemperature);
  json.set("temperature_offset", DHT_TEMP_OFFSET);
  json.set("humidity", humidity);
  json.set("peltier_status", peltierState ? "ON" : "OFF");
  json.set("auto_mode", autoMode);
  json.set("target_temperature", targetTemperature);
  json.set("timestamp", (int)millis());

  if (Firebase.RTDB.setJSON(&fbdo, (baseDevicePath + "/latest").c_str(), &json)) {
    Serial.println("[FIREBASE] Node 'latest' berhasil diperbarui.");
  } else {
    Serial.print("[FIREBASE] Gagal update latest: ");
    Serial.println(fbdo.errorReason());
  }

  if (Firebase.RTDB.pushJSON(&fbdo, (baseDevicePath + "/history").c_str(), &json)) {
    Serial.println("[FIREBASE] Data riwayat berhasil ditambahkan ke 'history'.");
  } else {
    Serial.print("[FIREBASE] Gagal push history: ");
    Serial.println(fbdo.errorReason());
  }
}

// =====================================================
// INIT FIREBASE FUNCTION
// =====================================================
void initFirebase() {
  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;
  config.token_status_callback = tokenStatusCallback;

  Serial.print("[FIREBASE] Melakukan Otentikasi Anonim... ");
  if (Firebase.signUp(&config, &auth, "", "")) {
    Serial.println("Sukses!");
    signupOK = true;
  } else {
    Serial.printf("Gagal! %s\n", config.signer.signupError.message.c_str());
  }

  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);
}

// =====================================================
// INISIALISASI SISTEM (SETUP)
// =====================================================
void setup() {
  Serial.begin(115200);

  pinMode(PELTIER_PIN, OUTPUT);
  setRelayPeltier(false);   // relay active-low: OFF = HIGH

  dht.begin();

  WiFi.setAutoReconnect(true);

  WiFiManager wm;
  Serial.println("[WIFI] Memeriksa jaringan saat booting...");

  if (!wm.autoConnect("ESP32-WarningSystem")) {
    Serial.println("[WIFI] Batas waktu booting habis. Masuk ke mode kontrol offline...");
  } else {
    Serial.println("[WIFI] Berhasil terhubung jaringan!");
    initFirebase();
  }
}

// =====================================================
// LOOP UTAMA
// =====================================================
void loop() {
  unsigned long currentMillis = millis();

  // Baca sensor
  float h = dht.readHumidity();
  float rawT = dht.readTemperature();

  // Kalibrasi suhu: DHT22 dikurangi 2°C
  float t = rawT + DHT_TEMP_OFFSET;

  if (!isnan(h) && !isnan(rawT)) {
    controlPeltier(t);
  }

  // =====================================================
  // AUTO-RECONNECT WIFI
  // =====================================================
  if (WiFi.status() != WL_CONNECTED) {
    if (lostConnectionMillis == 0) {
      lostConnectionMillis = currentMillis;
      signupOK = false;
      Serial.println("[WIFI] Koneksi terputus! Menunggu auto-reconnect...");
    }

    if (currentMillis - lostConnectionMillis > reconnectThreshold) {
      Serial.println("[WIFI] Gagal reconnect otomatis. Membuka Captive Portal...");

      WiFiManager wm;
      wm.setConfigPortalTimeout(60);

      if (wm.startConfigPortal("ESP32-WarningSystem")) {
        Serial.println("[WIFI] Berhasil terhubung ke WiFi baru via Portal!");
        lostConnectionMillis = 0;
        initFirebase();
      } else {
        Serial.println("[WIFI] Portal timeout/tidak ada konfigurasi.");
        lostConnectionMillis = millis();
      }
    }
  }
  else {
    if (lostConnectionMillis != 0) {
      Serial.println("[WIFI] Koneksi pulih kembali secara otomatis!");
      lostConnectionMillis = 0;
    }

    if (Firebase.ready() && signupOK) {
      if (currentMillis - lastSetpointRead >= setpointInterval) {
        lastSetpointRead = currentMillis;
        readControlFromFirebase();
      }

      if (currentMillis - lastSend >= sendInterval) {
        lastSend = currentMillis;

        if (!isnan(h) && !isnan(rawT)) {
          sendDataToFirebase(rawT, t, h);
        }
      }
    }
  }
}