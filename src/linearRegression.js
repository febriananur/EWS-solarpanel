/**
 * LINEAR REGRESSION ENGINE
 * ========================
 * Digunakan untuk memprediksi tren suhu ke depan berdasarkan data historis DHT22.
 *
 * Cara kerja:
 * - X = timestamp (dalam menit, dinormalisasi dari 0)
 * - Y = nilai suhu (°C)
 * - Model fitting: mencari garis y = mx + b yang paling cocok dengan data historis
 * - Prediksi: hitung y pada waktu X di masa depan
 *
 * Formula:
 *   m = (n*Σxy - Σx*Σy) / (n*Σx² - (Σx)²)
 *   b = (Σy - m*Σx) / n
 */

class LinearRegression {
  constructor() {
    this.slope = 0;         // m = laju kenaikan suhu per menit
    this.intercept = 0;     // b = suhu awal (saat t=0)
    this.rSquared = 0;      // R² = seberapa akurat model (0-1)
    this.dataPoints = [];
    this.isTrained = false;
    this.calculationLogs = null;
  }

  /**
   * Melatih model dengan data historis sensor
   * @param {Array} dataPoints - Array of { timestamp: ms, temperature: number }
   */
  train(dataPoints) {
    if (!dataPoints || dataPoints.length < 3) {
      this.isTrained = false;
      return { error: 'Minimal 3 data point diperlukan untuk training' };
    }

    this.dataPoints = dataPoints;

    // Normalisasi timestamp ke menit (dari titik pertama = 0)
    const baseTime = dataPoints[0].timestamp;
    const points = dataPoints.map(p => ({
      x: (p.timestamp - baseTime) / 60000, // konversi ms ke menit
      y: p.temperature,
      originalTime: p.timestamp
    }));

    const n = points.length;

    // Hitung komponen regresi
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

    for (const p of points) {
      sumX  += p.x;
      sumY  += p.y;
      sumXY += p.x * p.y;
      sumX2 += p.x * p.x;
    }

    // Hitung slope (m) dan intercept (b)
    const denominator = (n * sumX2) - (sumX * sumX);

    if (Math.abs(denominator) < 1e-10) {
      // Data terlalu mirip (flat), slope = 0
      this.slope = 0;
      this.intercept = sumY / n;
    } else {
      this.slope     = ((n * sumXY) - (sumX * sumY)) / denominator;
      this.intercept = (sumY - this.slope * sumX) / n;
    }

    // Hitung R² (koefisien determinasi) — seberapa cocok model
    const r2Stats = this._calculateRSquared(points);
    this.rSquared = r2Stats.rSquared;

    this.isTrained = true;
    this._lastBaseTime = baseTime;
    this._lastDataTime = dataPoints[dataPoints.length - 1].timestamp;

    this.calculationLogs = {
      n,
      baseTime,
      points: points.map(p => ({ x: p.x, y: p.y, originalTime: p.originalTime })),
      sumX,
      sumY,
      sumXY,
      sumX2,
      denominator,
      slope: this.slope,
      intercept: this.intercept,
      rSquared: this.rSquared,
      yMean: r2Stats.yMean,
      ssTot: r2Stats.ssTot,
      ssRes: r2Stats.ssRes
    };

    return {
      slope: this.slope,
      intercept: this.intercept,
      rSquared: this.rSquared,
      dataCount: n,
      interpretation: this._interpretSlope(),
      calculationLogs: this.calculationLogs
    };
  }

  /**
   * Prediksi suhu N menit ke depan dari data terakhir
   * @param {number} minutesAhead - berapa menit ke depan yang diprediksi
   */
  predict(minutesAhead) {
    if (!this.isTrained) {
      return { error: 'Model belum ditraining' };
    }

    // Hitung X dari titik data pertama
    const currentXMinutes = (this._lastDataTime - this._lastBaseTime) / 60000;
    const futureX = currentXMinutes + minutesAhead;

    const predictedTemp = this.slope * futureX + this.intercept;

    return {
      minutesAhead,
      predictedTemperature: Math.round(predictedTemp * 10) / 10,
      confidence: Math.round(this.rSquared * 100),
      trend: this.slope > 0.1 ? 'naik' : this.slope < -0.1 ? 'turun' : 'stabil',
      ratePerMinute: Math.round(this.slope * 100) / 100,
      log: {
        currentXMinutes,
        futureX,
        slope: this.slope,
        intercept: this.intercept,
        predictedTemp
      }
    };
  }

  /**
   * Hitung berapa menit lagi suhu mencapai threshold bahaya
   * @param {number} thresholdTemp - suhu threshold (°C)
   * @param {number} currentTemp - suhu saat ini
   */
  minutesToThreshold(thresholdTemp, currentTemp) {
    if (!this.isTrained || this.slope <= 0) {
      return null; // Suhu tidak naik, tidak akan mencapai threshold
    }

    // t = (threshold - currentTemp) / slope
    const minutesLeft = (thresholdTemp - currentTemp) / this.slope;

    if (minutesLeft <= 0) return 0; // Sudah melewati threshold

    return Math.round(minutesLeft);
  }

  /**
   * Hitung R² (Coefficient of Determination)
   */
  _calculateRSquared(points) {
    const yMean = points.reduce((sum, p) => sum + p.y, 0) / points.length;

    let ssTot = 0; // Total sum of squares
    let ssRes = 0; // Residual sum of squares

    for (const p of points) {
      const yPred = this.slope * p.x + this.intercept;
      ssTot += Math.pow(p.y - yMean, 2);
      ssRes += Math.pow(p.y - yPred, 2);
    }

    if (ssTot === 0) return { rSquared: 1, yMean, ssTot, ssRes }; // Semua nilai sama
    return { rSquared: Math.max(0, 1 - (ssRes / ssTot)), yMean, ssTot, ssRes };
  }

  _interpretSlope() {
    const ratePerHour = this.slope * 60;
    if (this.slope > 0.5)  return `Suhu naik cepat (~${ratePerHour.toFixed(1)}°C/jam) ⚠️`;
    if (this.slope > 0.1)  return `Suhu naik perlahan (~${ratePerHour.toFixed(1)}°C/jam)`;
    if (this.slope < -0.1) return `Suhu turun (~${Math.abs(ratePerHour).toFixed(1)}°C/jam)`;
    return 'Suhu stabil';
  }

  /**
   * Mendapatkan data untuk visualisasi garis regresi
   */
  getRegressionLine(numPoints = 20) {
    if (!this.isTrained) return [];

    const baseTime  = this._lastBaseTime;
    const totalMins = (this._lastDataTime - baseTime) / 60000;
    const step = totalMins / numPoints;

    const line = [];
    for (let i = 0; i <= numPoints; i++) {
      const xMin = i * step;
      line.push({
        timestamp: baseTime + xMin * 60000,
        temperature: Math.round((this.slope * xMin + this.intercept) * 10) / 10
      });
    }

    // Tambah titik prediksi ke depan (5 menit)
    const futureStart = totalMins;
    for (let i = 1; i <= 5; i++) {
      const xMin = futureStart + i;
      line.push({
        timestamp: baseTime + xMin * 60000,
        temperature: Math.round((this.slope * xMin + this.intercept) * 10) / 10,
        isPrediction: true
      });
    }

    return line;
  }
}

module.exports = LinearRegression;
