/**
 * SISTEM NOTIFIKASI & KLASIFIKASI BAHAYA
 * ========================================
 * Menentukan level bahaya dan format notifikasi berdasarkan:
 * - Suhu aktual dari DHT22
 * - Kelembaban aktual dari DHT22
 * - Prediksi suhu (dari Linear Regression)
 * - Laju kenaikan suhu (slope)
 */

const THRESHOLDS = {
  temperature: {
    normal:  { max: 30 },          // < 30°C = normal / suhu dingin AC
    warning: { min: 30, max: 40 }, // 30–40°C = mulai panas (waspada)
    danger:  { min: 40, max: 50 }, // 40–50°C = overheat (bahaya)
    critical:{ min: 50 }           // >= 50°C = kritis / risiko kebakaran
  },
  humidity: {
    tooLow:  10,  // < 10% = sangat kering, rawan api
    low:     20,  // < 20% = kering
    normal:  40   // > 40% = aman
  },
  slope: {
    rapid: 0.5,   // Naik > 0.5°C/menit = kenaikan cepat
    fast:  0.2    // Naik > 0.2°C/menit = kenaikan sedang
  }
};

/**
 * Klasifikasi level bahaya berdasarkan semua faktor
 */
function classifyDanger(sensorData, prediction, modelStats) {
  const { temperature, humidity } = sensorData;
  const slope = modelStats?.slope || 0;

  // Tentukan level bahaya suhu saat ini
  let tempLevel = 'normal';
  if (temperature >= THRESHOLDS.temperature.critical.min) {
    tempLevel = 'critical';
  } else if (temperature >= THRESHOLDS.temperature.danger.min) {
    tempLevel = 'danger';
  } else if (temperature >= THRESHOLDS.temperature.warning.min) {
    tempLevel = 'warning';
  }

  // Tentukan level bahaya kelembaban
  let humidityRisk = 'normal';
  if (humidity < THRESHOLDS.humidity.tooLow) {
    humidityRisk = 'critical'; // Sangat kering
  } else if (humidity < THRESHOLDS.humidity.low) {
    humidityRisk = 'high';
  }

  // Cek prediksi — apakah akan mencapai bahaya dalam waktu dekat?
  let predictionRisk = 'none';
  if (prediction) {
    const { predictedTemperature, minutesAhead } = prediction;
    if (predictedTemperature >= THRESHOLDS.temperature.critical.min) {
      predictionRisk = 'critical';
    } else if (predictedTemperature >= THRESHOLDS.temperature.danger.min) {
      predictionRisk = 'danger';
    } else if (predictedTemperature >= THRESHOLDS.temperature.warning.min) {
      predictionRisk = 'warning';
    }
  }

  // Tentukan level akhir (ambil yang tertinggi)
  const levelOrder = ['normal', 'warning', 'danger', 'critical'];
  const levels = [tempLevel, predictionRisk];
  if (humidityRisk === 'critical') levels.push('critical');
  if (humidityRisk === 'high') levels.push('warning');

  const finalLevel = levels.reduce((highest, current) => {
    return levelOrder.indexOf(current) > levelOrder.indexOf(highest) ? current : highest;
  }, 'normal');

  return {
    level: finalLevel,
    tempLevel,
    humidityRisk,
    predictionRisk,
    factors: buildFactorList(temperature, humidity, slope, prediction)
  };
}

/**
 * Generate pesan notifikasi berdasarkan level bahaya
 */
function generateAlert(dangerInfo, sensorData, prediction, minutesToDanger) {
  const { level, factors } = dangerInfo;
  const { temperature, humidity } = sensorData;

  const alerts = {
    normal: null, // Tidak ada notifikasi saat normal

    warning: {
      level: 'warning',
      title: '⚠️ Peringatan: Suhu Meningkat',
      message: `Suhu panel surya mencapai ${temperature}°C. Pantau kondisi secara berkala.`,
      detail: factors.join(' | '),
      action: 'Periksa ventilasi dan pastikan panel tidak terhalang.',
      sound: 'warning',
      color: '#F59E0B'
    },

    danger: {
      level: 'danger',
      title: '🔴 BAHAYA: Suhu Tinggi Terdeteksi',
      message: `Suhu kritis ${temperature}°C dengan kelembaban ${humidity}%.${
        minutesToDanger ? ` Prediksi mencapai zona kritis dalam ~${minutesToDanger} menit.` : ''
      }`,
      detail: factors.join(' | '),
      action: 'SEGERA periksa panel surya! Pastikan tidak ada komponen yang overheat.',
      sound: 'danger',
      color: '#EF4444'
    },

    critical: {
      level: 'critical',
      title: '🚨 KRITIS: RISIKO KEBAKARAN TINGGI',
      message: `SUHU EKSTREM ${temperature}°C! Risiko kebakaran sangat tinggi. Kelembaban ${humidity}%.`,
      detail: factors.join(' | '),
      action: '⛔ MATIKAN SISTEM SEGERA! Hubungi petugas pemadam kebakaran jika diperlukan.',
      sound: 'critical',
      color: '#DC2626'
    }
  };

  const alert = alerts[level];
  if (!alert) return null;

  return {
    ...alert,
    timestamp: new Date().toISOString(),
    id: `alert_${Date.now()}`,
    sensorData: { temperature, humidity },
    prediction: prediction ? {
      predictedTemp: prediction.predictedTemperature,
      minutesAhead: prediction.minutesAhead,
      confidence: prediction.confidence
    } : null
  };
}

function buildFactorList(temperature, humidity, slope, prediction) {
  const factors = [];

  factors.push(`Suhu: ${temperature}°C`);
  factors.push(`Kelembaban: ${humidity}%`);

  if (slope > THRESHOLDS.slope.rapid) {
    factors.push(`⬆️ Naik cepat: +${(slope * 60).toFixed(1)}°C/jam`);
  } else if (slope > THRESHOLDS.slope.fast) {
    factors.push(`↗️ Naik: +${(slope * 60).toFixed(1)}°C/jam`);
  }

  if (humidity < THRESHOLDS.humidity.low) {
    factors.push('🌵 Kelembaban rendah (kondisi kering)');
  }

  if (prediction) {
    factors.push(`📈 Prediksi ${prediction.minutesAhead}m: ${prediction.predictedTemperature}°C (${prediction.confidence}% akurasi)`);
  }

  return factors;
}

module.exports = { classifyDanger, generateAlert, THRESHOLDS };
