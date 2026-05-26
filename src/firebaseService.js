/**
 * FIREBASE SERVICE
 * ================
 * Mengelola koneksi dan operasi Firebase Realtime Database.
 *
 * Struktur data di Firebase (sesuai ESP32 .ino):
 * /devices/
 *   /{device_id}/
 *     latest/
 *       device_id: "esp32_01"
 *       temperature_raw: 32.5
 *       temperature: 30.0          (setelah kalibrasi)
 *       temperature_offset: -2.5
 *       humidity: 65.2
 *       peltier_status: "ON"/"OFF"
 *       auto_mode: true/false
 *       target_temperature: 28.0
 *       timestamp: 123456          (millis() dari ESP32)
 *     history/
 *       /{push_id}/
 *         (sama seperti latest)
 *
 * /control/
 *   /{device_id}/
 *     target_temperature: 28.0
 *     auto_mode: true
 */

const admin = require('firebase-admin');

let db = null;

function initFirebase() {
  if (admin.apps.length > 0) return; // Sudah diinisialisasi

  const serviceAccount = {
    type: 'service_account',
    project_id:                process.env.FIREBASE_PROJECT_ID,
    private_key_id:            process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key:               process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email:              process.env.FIREBASE_CLIENT_EMAIL,
    auth_uri:                  'https://accounts.google.com/o/oauth2/auth',
    token_uri:                 'https://oauth2.googleapis.com/token',
  };

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });

  db = admin.database();
  console.log('✅ Firebase initialized');
}

/**
 * Konversi timestamp millis() ESP32 ke Unix timestamp (ms).
 * ESP32 mengirim millis() yang merupakan uptime, bukan Unix time.
 * Kita estimasi Unix timestamp berdasarkan waktu server saat data diterima.
 *
 * Untuk data historis: kita gunakan jarak relatif antar data point
 * dan anchor ke waktu server sekarang.
 */
function normalizeHistoryTimestamps(dataArray) {
  if (!dataArray || dataArray.length === 0) return [];

  const now = Date.now();

  // Ambil millis() terbesar (data terakhir) sebagai acuan = "sekarang"
  const latestMillis = Math.max(...dataArray.map(d => d.timestamp || 0));

  return dataArray.map(d => {
    const espMillis = d.timestamp || 0;
    // Hitung selisih dari data terakhir, lalu kurangi dari waktu sekarang
    const offsetMs = latestMillis - espMillis;
    return {
      ...d,
      timestamp: now - offsetMs
    };
  });
}

/**
 * Ambil data sensor terkini dari /devices/{deviceId}/latest
 * @param {string} deviceId - ID device (default: 'esp32_01')
 */
async function getCurrentReading(deviceId = 'esp32_01') {
  const snapshot = await db.ref(`devices/${deviceId}/latest`).once('value');
  const data = snapshot.val();
  if (!data) return null;

  // Konversi timestamp millis() ke Unix timestamp
  return {
    ...data,
    timestamp: Date.now()
  };
}

/**
 * Ambil data historis untuk training model Linear Regression
 * dari /devices/{deviceId}/history
 * @param {string} deviceId
 * @param {number} limitPoints - jumlah data point terakhir yang diambil
 */
async function getHistoricalData(deviceId = 'esp32_01', limitPoints = 30) {
  const snapshot = await db
    .ref(`devices/${deviceId}/history`)
    .orderByKey()
    .limitToLast(limitPoints)
    .once('value');

  const raw = snapshot.val();
  if (!raw) return [];

  // Konversi object ke array
  const dataArray = Object.values(raw);

  // Normalisasi timestamp millis() ke Unix timestamp
  const normalized = normalizeHistoryTimestamps(dataArray);

  // Urutkan berdasarkan timestamp
  return normalized.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Listen real-time ke perubahan sensor di /devices/{deviceId}/latest
 * @param {string} deviceId
 * @param {Function} callback - dipanggil setiap ada data baru
 */
function subscribeToSensor(deviceId = 'esp32_01', callback) {
  const ref = db.ref(`devices/${deviceId}/latest`);

  ref.on('value', (snapshot) => {
    const data = snapshot.val();
    if (data) {
      // Konversi timestamp millis() ke Unix timestamp
      callback({
        ...data,
        timestamp: Date.now()
      });
    }
  });

  // Return unsubscribe function
  return () => ref.off('value');
}

/**
 * Ambil status kontrol dari /control/{deviceId}
 * @param {string} deviceId
 */
async function getControlState(deviceId = 'esp32_01') {
  const snapshot = await db.ref(`control/${deviceId}`).once('value');
  return snapshot.val() || {
    target_temperature: 28.0,
    auto_mode: true
  };
}

/**
 * Tulis setpoint kontrol ke /control/{deviceId}
 * ESP32 membaca dari path ini untuk mendapatkan target suhu dan mode auto.
 * @param {string} deviceId
 * @param {object} controlData - { target_temperature, auto_mode }
 */
async function setControl(deviceId = 'esp32_01', controlData) {
  const updates = {};
  if (controlData.target_temperature !== undefined) {
    updates.target_temperature = parseFloat(controlData.target_temperature);
  }
  if (controlData.auto_mode !== undefined) {
    updates.auto_mode = Boolean(controlData.auto_mode);
  }
  await db.ref(`control/${deviceId}`).update(updates);
  return updates;
}

/**
 * Simpan hasil prediksi ke Firebase (opsional, untuk logging)
 */
async function savePrediction(deviceId = 'esp32_01', predictionData) {
  await db.ref(`devices/${deviceId}/predictions`).push({
    ...predictionData,
    savedAt: admin.database.ServerValue.TIMESTAMP
  });
}

/**
 * Simpan alert ke Firebase
 */
async function saveAlert(deviceId = 'esp32_01', alertData) {
  await db.ref(`devices/${deviceId}/alerts`).push({
    ...alertData,
    savedAt: admin.database.ServerValue.TIMESTAMP
  });
}

/**
 * Mock data generator untuk testing (tanpa hardware)
 * Simulasi kenaikan suhu yang memicu early warning
 */
function generateMockData(baseTemp = 30, trend = 'rising') {
  const now = Date.now();
  const history = [];

  for (let i = 29; i >= 0; i--) {
    const minutesAgo = i;
    let temp = baseTemp;

    if (trend === 'rising') {
      // Mulai dari baseTemp (misal 30°C) dan naik dramatis hingga >50°C (overheat/kebakaran)
      temp = baseTemp + (29 - i) * 0.8 + (Math.random() - 0.5) * 1.5;
    } else if (trend === 'stable') {
      // Stabil di sekitar suhu dasar (30°C untuk suhu ruang tanpa AC)
      temp = baseTemp + (Math.random() - 0.5) * 1.2;
    } else if (trend === 'cooling') {
      // Turun dari suhu ruang (30°C) menuju suhu AC terdingin (16°C)
      temp = baseTemp - (29 - i) * 0.48 + (Math.random() - 0.5) * 0.8;
    }

    history.push({
      temperature: Math.round(temp * 10) / 10,
      temperature_raw: Math.round((temp + 2.5) * 10) / 10,
      temperature_offset: -2.5,
      humidity:    Math.round((65 - (29 - i) * 0.5 + (Math.random() - 0.5) * 3) * 10) / 10,
      peltier_status: temp >= baseTemp ? 'ON' : 'OFF',
      auto_mode: true,
      target_temperature: baseTemp,
      timestamp:   now - minutesAgo * 60000
    });
  }

  // Current reading = data terbaru
  const latest = history[history.length - 1];

  return { history, current: latest };
}

module.exports = {
  initFirebase,
  getCurrentReading,
  getHistoricalData,
  subscribeToSensor,
  getControlState,
  setControl,
  savePrediction,
  saveAlert,
  generateMockData,
  getDB: () => db
};
