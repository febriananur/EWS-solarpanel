/**
 * FIREBASE SERVICE
 * ================
 * Mengelola koneksi dan operasi Firebase Realtime Database.
 *
 * Struktur data di Firebase yang diharapkan:
 * /sensors/
 *   /{sensor_id}/
 *     current/
 *       temperature: 52.3
 *       humidity: 35.2
 *       timestamp: 1710000000000
 *     history/
 *       /{push_id}/
 *         temperature: 52.3
 *         humidity: 35.2
 *         timestamp: 1710000000000
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
 * Ambil data sensor terkini
 * @param {string} sensorId - ID sensor (default: 'panel_01')
 */
async function getCurrentReading(sensorId = 'panel_01') {
  const snapshot = await db.ref(`sensors/${sensorId}/current`).once('value');
  return snapshot.val();
}

/**
 * Ambil data historis untuk training model Linear Regression
 * @param {string} sensorId
 * @param {number} limitPoints - jumlah data point terakhir yang diambil
 */
async function getHistoricalData(sensorId = 'panel_01', limitPoints = 30) {
  const snapshot = await db
    .ref(`sensors/${sensorId}/history`)
    .orderByChild('timestamp')
    .limitToLast(limitPoints)
    .once('value');

  const raw = snapshot.val();
  if (!raw) return [];

  // Konversi object ke array dan urutkan berdasarkan timestamp
  return Object.values(raw)
    .sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Listen real-time ke perubahan sensor
 * @param {string} sensorId
 * @param {Function} callback - dipanggil setiap ada data baru
 */
function subscribeToSensor(sensorId = 'panel_01', callback) {
  const ref = db.ref(`sensors/${sensorId}/current`);

  ref.on('value', (snapshot) => {
    const data = snapshot.val();
    if (data) callback(data);
  });

  // Return unsubscribe function
  return () => ref.off('value');
}

/**
 * Simpan hasil prediksi ke Firebase (opsional, untuk logging)
 */
async function savePrediction(sensorId = 'panel_01', predictionData) {
  await db.ref(`sensors/${sensorId}/predictions`).push({
    ...predictionData,
    savedAt: admin.database.ServerValue.TIMESTAMP
  });
}

/**
 * Simpan alert ke Firebase
 */
async function saveAlert(sensorId = 'panel_01', alertData) {
  await db.ref(`sensors/${sensorId}/alerts`).push({
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
      humidity:    Math.round((65 - (29 - i) * 0.5 + (Math.random() - 0.5) * 3) * 10) / 10,
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
  savePrediction,
  saveAlert,
  generateMockData,
  getDB: () => db
};
