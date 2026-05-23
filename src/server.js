/**
 * MAIN SERVER - Solar Panel Fire Early Warning System
 * ====================================================
 * Stack: Express + Socket.IO + Firebase + Linear Regression
 *
 * Flow:
 * 1. Ambil data historis dari Firebase
 * 2. Train model Linear Regression
 * 3. Prediksi suhu N menit ke depan
 * 4. Klasifikasi level bahaya
 * 5. Kirim real-time update via Socket.IO ke dashboard
 * 6. Trigger notifikasi jika bahaya terdeteksi
 */

require('dotenv').config();

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const cors    = require('cors');
const cron    = require('node-cron');
const path    = require('path');

const LinearRegression = require('./linearRegression');
const { classifyDanger, generateAlert, THRESHOLDS } = require('./alertSystem');
const firebase  = require('./firebaseService');
const telegram  = require('./telegramService');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ─── State Global ────────────────────────────────────────────────────────────
const model       = new LinearRegression();
const SENSOR_ID   = process.env.SENSOR_ID || 'panel_01';
const PRED_MINS   = parseInt(process.env.PREDICTION_MINUTES) || 10;
const USE_MOCK    = process.env.USE_MOCK === 'true'; // Gunakan data simulasi

let latestState   = null;
let alertHistory  = [];
const MAX_ALERTS  = 50;
let activeMockTrend = process.env.MOCK_TREND || 'rising'; // Tren simulasi aktif ('rising', 'stable', 'cooling')

// ─── Core Processing Function ─────────────────────────────────────────────────
async function processEarlyWarning() {
  try {
    let history, current;

    if (USE_MOCK) {
      // Mode demo: simulasikan suhu berdasarkan tren aktif
      const mock = firebase.generateMockData(30, activeMockTrend);
      history = mock.history;
      current = mock.current;
    } else {
      // Mode produksi: ambil dari Firebase
      history = await firebase.getHistoricalData(SENSOR_ID, 30);
      current = await firebase.getCurrentReading(SENSOR_ID);
    }

    if (!current || history.length < 3) {
      console.log('⏳ Data belum cukup untuk analisis...');
      return;
    }

    // ── Step 1: Train Linear Regression ────────────────────────────────────
    const modelStats = model.train(history);
    console.log(`📊 Model trained | slope: ${modelStats.slope?.toFixed(3)}°C/min | R²: ${modelStats.rSquared?.toFixed(3)}`);

    // ── Step 2: Prediksi suhu ke depan ─────────────────────────────────────
    const prediction = model.predict(PRED_MINS);
    const minutesToDanger = model.minutesToThreshold(THRESHOLDS.temperature.critical.min, current.temperature);
    const regressionLine  = model.getRegressionLine(15);

    // ── Step 3: Klasifikasi bahaya ──────────────────────────────────────────
    const dangerInfo = classifyDanger(current, prediction, modelStats);

    // ── Step 4: Generate alert jika diperlukan ──────────────────────────────
    const alert = generateAlert(dangerInfo, current, prediction, minutesToDanger);

    if (alert) {
      alertHistory.unshift(alert);
      if (alertHistory.length > MAX_ALERTS) alertHistory.pop();

      // Simpan ke Firebase
      if (!USE_MOCK) {
        await firebase.saveAlert(SENSOR_ID, alert).catch(console.error);
      }

      console.log(`🚨 [${alert.level.toUpperCase()}] ${alert.title}`);

      // ── Kirim notifikasi Telegram (dengan rate limiting) ──────────────────
      await telegram.notify(alert, prediction, modelStats, minutesToDanger);
    } else {
      // Status kembali normal → reset recovery cooldown Telegram
      telegram.onStatusNormal();
    }

    // ── Step 5: Broadcast ke dashboard via Socket.IO ────────────────────────
    latestState = {
      timestamp:       new Date().toISOString(),
      sensor: {
        temperature:   current.temperature,
        humidity:      current.humidity,
        sensorTime:    current.timestamp
      },
      model: {
        slope:         modelStats.slope,
        intercept:     modelStats.intercept,
        rSquared:      modelStats.rSquared,
        interpretation: modelStats.interpretation,
        dataPoints:    history.length,
        calculationLogs: modelStats.calculationLogs
      },
      prediction: {
        minutesAhead:         prediction.minutesAhead,
        predictedTemperature: prediction.predictedTemperature,
        trend:                prediction.trend,
        ratePerMinute:        prediction.ratePerMinute,
        confidence:           prediction.confidence,
        log:                  prediction.log
      },
      danger: {
        level:          dangerInfo.level,
        tempLevel:      dangerInfo.tempLevel,
        humidityRisk:   dangerInfo.humidityRisk,
        predictionRisk: dangerInfo.predictionRisk,
        factors:        dangerInfo.factors,
        minutesToDanger
      },
      chart: {
        historicalData: history.slice(-20), // 20 titik terakhir
        regressionLine
      },
      latestAlert: alert || null
    };

    io.emit('sensor-update', latestState);

  } catch (err) {
    console.error('❌ Error processing EWS:', err.message);
    io.emit('error', { message: err.message });
  }
}

// ─── API Routes ───────────────────────────────────────────────────────────────

// Status sistem
app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    mode: USE_MOCK ? 'demo' : 'production',
    mockTrend: USE_MOCK ? activeMockTrend : null,
    sensorId: SENSOR_ID,
    predictionWindow: `${PRED_MINS} menit`,
    modelTrained: model.isTrained,
    lastUpdate: latestState?.timestamp || null,
    telegram: telegram.getStatus(),
  });
});

// Status rate limit Telegram secara detail
app.get('/api/telegram-status', (req, res) => {
  res.json(telegram.getStatus());
});

// Data terkini
app.get('/api/latest', (req, res) => {
  if (!latestState) {
    return res.status(202).json({ message: 'Menunggu data sensor...' });
  }
  res.json(latestState);
});

// Riwayat alert
app.get('/api/alerts', (req, res) => {
  res.json(alertHistory);
});

// Endpoint untuk mengubah tren data mock secara dinamis dari dashboard
app.post('/api/mock/trend', async (req, res) => {
  if (!USE_MOCK) {
    return res.status(400).json({ error: 'Fitur ini hanya tersedia dalam mode DEMO (USE_MOCK=true)' });
  }
  const { trend } = req.body;
  if (!['rising', 'stable', 'cooling'].includes(trend)) {
    return res.status(400).json({ error: 'Tren tidak valid. Harus salah satu dari: rising, stable, cooling' });
  }
  activeMockTrend = trend;
  console.log(`🔄 Mode DEMO: Tren simulasi diubah menjadi [${trend.toUpperCase()}]`);
  
  // Langsung jalankan pemrosesan agar data baru langsung terbentuk dan disiarkan
  await processEarlyWarning();
  
  res.json({ success: true, activeTrend: activeMockTrend });
});

// Manual trigger analisis
app.post('/api/analyze', async (req, res) => {
  await processEarlyWarning();
  res.json({ message: 'Analisis selesai', state: latestState });
});

// Endpoint untuk testing prediksi dengan suhu kustom
app.post('/api/predict', (req, res) => {
  const { minutes = PRED_MINS } = req.body;
  if (!model.isTrained) {
    return res.status(400).json({ error: 'Model belum ditraining' });
  }
  const result = model.predict(parseInt(minutes));
  res.json(result);
});

// ─── Socket.IO Events ─────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🔌 Dashboard terhubung: ${socket.id}`);

  // Kirim state terkini ke client yang baru terhubung
  if (latestState) {
    socket.emit('sensor-update', latestState);
  }

  // Kirim history alert
  socket.emit('alert-history', alertHistory);

  socket.on('disconnect', () => {
    console.log(`🔌 Dashboard terputus: ${socket.id}`);
  });
});

// ─── Scheduled Jobs ───────────────────────────────────────────────────────────
// Jalankan analisis secara berkala: setiap 5 detik untuk mode Mock (agar demo cepat), atau setiap 1 menit untuk mode Produksi
if (USE_MOCK) {
  console.log('⏱️  Mode DEMO: Analisis dan update dashboard dijalankan setiap 5 detik');
  setInterval(() => {
    processEarlyWarning();
  }, 5000);
} else {
  cron.schedule('* * * * *', () => {
    processEarlyWarning();
  });
}


// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

async function start() {
  if (!USE_MOCK) {
    firebase.initFirebase();

    // Subscribe real-time untuk trigger langsung saat ada data baru
    firebase.subscribeToSensor(SENSOR_ID, () => {
      processEarlyWarning();
    });
  }

  // Jalankan analisis pertama kali saat startup
  await processEarlyWarning();

  server.listen(PORT, () => {
    const tgStatus = telegram.getStatus();
    console.log(`
╔══════════════════════════════════════════════╗
║   🔥 Solar Panel Fire EWS - RUNNING          ║
║   Dashboard: http://localhost:${PORT}           ║
║   Mode: ${USE_MOCK ? 'DEMO (simulasi data)      ' : 'PRODUCTION (Firebase)   '}  ║
║   Sensor: ${SENSOR_ID.padEnd(30)}  ║
║   Prediksi: ${PRED_MINS} menit ke depan              ║
║   Telegram: ${tgStatus.enabled ? `✅ aktif (${tgStatus.chatCount} chat)       ` : '❌ nonaktif              '}  ║
╚══════════════════════════════════════════════╝
    `);
  });
}

start().catch(console.error);
