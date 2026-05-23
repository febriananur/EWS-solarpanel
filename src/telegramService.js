/**
 * TELEGRAM NOTIFICATION SERVICE
 * ==============================
 * Mengirim notifikasi ke Telegram saat terdeteksi bahaya atau prediksi kritis.
 *
 * Rate Limiting Strategy (per level):
 * - WARNING  → maks 1x per 30 menit
 * - DANGER   → maks 1x per 15 menit
 * - CRITICAL → maks 1x per 5 menit (darurat, lebih sering)
 *
 * Fitur tambahan:
 * - Cooldown setelah level turun (tidak spam saat naik-turun)
 * - Log setiap pengiriman + alasan skip
 * - Mendukung multiple Chat ID (grup + personal)
 */

const https = require('https');

// ─── Rate Limit Config (dalam milidetik) ──────────────────────────────────────
const RATE_LIMITS = {
  warning:  30 * 60 * 1000,  // 30 menit
  danger:   15 * 60 * 1000,  // 15 menit
  critical:  5 * 60 * 1000,  //  5 menit
};

// Cooldown setelah level turun ke normal (hindari spam saat fluktuasi)
const RECOVERY_COOLDOWN = 10 * 60 * 1000; // 10 menit

class TelegramService {
  constructor() {
    this.botToken  = process.env.TELEGRAM_BOT_TOKEN;
    this.chatIds   = this._parseChatIds(process.env.TELEGRAM_CHAT_ID);
    this.enabled   = !!(this.botToken && this.chatIds.length > 0);

    // State rate limiting per level
    this.lastSent = {
      warning:  null,
      danger:   null,
      critical: null,
    };

    // Level terakhir yang dikirim (untuk deteksi perubahan level)
    this.lastSentLevel   = null;
    this.lastNormalTime  = null; // Kapan terakhir kali status kembali normal

    if (this.enabled) {
      console.log(`✅ Telegram: aktif | ${this.chatIds.length} chat target`);
    } else {
      console.log('⚠️  Telegram: nonaktif (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID belum diset)');
    }
  }

  /**
   * Entry point utama — dipanggil dari server.js setelah analisis selesai
   * @param {Object} alert      - Hasil dari generateAlert()
   * @param {Object} prediction - Hasil dari model.predict()
   * @param {Object} modelStats - slope, rSquared, dll
   * @param {number|null} minutesToDanger
   */
  async notify(alert, prediction, modelStats, minutesToDanger) {
    if (!this.enabled) return;
    if (!alert)        return; // Level normal, tidak ada alert

    const { level } = alert;

    // ── Cek rate limit ──────────────────────────────────────────────────────
    const rateLimitMs    = RATE_LIMITS[level];
    const lastSentTime   = this.lastSent[level];
    const now            = Date.now();

    if (lastSentTime && (now - lastSentTime) < rateLimitMs) {
      const sisaMenit = Math.ceil((rateLimitMs - (now - lastSentTime)) / 60000);
      console.log(`📵 Telegram skip [${level}]: cooldown ${sisaMenit} menit lagi`);
      return;
    }

    // ── Cek recovery cooldown (hindari spam saat level baru naik lagi) ──────
    if (this.lastNormalTime && (now - this.lastNormalTime) < RECOVERY_COOLDOWN) {
      const sisaMenit = Math.ceil((RECOVERY_COOLDOWN - (now - this.lastNormalTime)) / 60000);
      // Hanya berlaku untuk warning, bukan danger/critical
      if (level === 'warning') {
        console.log(`📵 Telegram skip [warning]: recovery cooldown ${sisaMenit} menit lagi`);
        return;
      }
    }

    // ── Bangun pesan Telegram ───────────────────────────────────────────────
    const message = this._buildMessage(alert, prediction, modelStats, minutesToDanger);

    // ── Kirim ke semua chat ID ──────────────────────────────────────────────
    let berhasil = 0;
    for (const chatId of this.chatIds) {
      const ok = await this._sendMessage(chatId, message);
      if (ok) berhasil++;
    }

    if (berhasil > 0) {
      this.lastSent[level] = now;
      this.lastSentLevel   = level;
      console.log(`📤 Telegram terkirim [${level.toUpperCase()}] → ${berhasil}/${this.chatIds.length} chat`);
    }
  }

  /**
   * Dipanggil saat status kembali ke normal
   * Mencatat waktu recovery untuk cooldown
   */
  onStatusNormal() {
    if (this.lastSentLevel && this.lastSentLevel !== 'normal') {
      this.lastNormalTime  = Date.now();
      this.lastSentLevel   = 'normal';
      console.log('✅ Telegram: status kembali normal, recovery cooldown dimulai');
    }
  }

  /**
   * Build pesan Telegram dengan format Markdown
   */
  _buildMessage(alert, prediction, modelStats, minutesToDanger) {
    const { level, title, message, action, sensorData } = alert;
    const { temperature, humidity } = sensorData;

    const emoji = { warning: '⚠️', danger: '🔴', critical: '🚨' };
    const now = new Date().toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    // Header
    let text = `${emoji[level] || '⚠️'} *${this._escMd(title)}*\n`;
    text += `\`${now} WIB\`\n\n`;

    // Data sensor
    text += `📡 *Data Sensor DHT22*\n`;
    text += `• Suhu Aktual   : \`${temperature}°C\`\n`;
    text += `• Kelembaban    : \`${humidity}%\`\n\n`;

    // Hasil Linear Regression
    if (modelStats && prediction) {
      text += `📊 *Analisis Linear Regression*\n`;
      text += `• Slope \\(m\\)  : \`${modelStats.slope >= 0 ? '+' : ''}${modelStats.slope.toFixed(4)} °C/menit\`\n`;
      text += `• Akurasi R²   : \`${(modelStats.rSquared * 100).toFixed(1)}%\`\n`;
      text += `• Tren         : \`${prediction.trend === 'naik' ? '↑ Naik' : prediction.trend === 'turun' ? '↓ Turun' : '→ Stabil'}\`\n`;
      text += `• Prediksi *${prediction.minutesAhead} mnt* ke depan: \`${prediction.predictedTemperature}°C\`\n`;

      if (minutesToDanger != null) {
        text += `• ⏱ Estimasi kritis: \`~${minutesToDanger} menit lagi\`\n`;
      }
      text += '\n';
    }

    // Pesan bahaya
    text += `📋 *Keterangan*\n${this._escMd(message)}\n\n`;

    // Tindakan
    text += `🛠 *Tindakan yang Diperlukan*\n${this._escMd(action)}\n\n`;

    // Footer
    text += `_Solar Panel Fire EWS · panel\\_01_`;

    return text;
  }

  /**
   * Kirim pesan via Telegram Bot API
   */
  _sendMessage(chatId, text) {
    return new Promise((resolve) => {
      const body = JSON.stringify({
        chat_id:    chatId,
        text,
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
      });

      const options = {
        hostname: 'api.telegram.org',
        path:     `/bot${this.botToken}/sendMessage`,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (!json.ok) {
              console.error(`❌ Telegram error [${chatId}]:`, json.description);
              resolve(false);
            } else {
              resolve(true);
            }
          } catch {
            resolve(false);
          }
        });
      });

      req.on('error', (err) => {
        console.error('❌ Telegram network error:', err.message);
        resolve(false);
      });

      req.setTimeout(8000, () => {
        console.error('❌ Telegram timeout');
        req.destroy();
        resolve(false);
      });

      req.write(body);
      req.end();
    });
  }

  /**
   * Parse TELEGRAM_CHAT_ID — mendukung satu atau beberapa ID dipisah koma
   * Contoh: "123456789" atau "123456789,-987654321,111222333"
   */
  _parseChatIds(raw) {
    if (!raw) return [];
    return raw.split(',').map(id => id.trim()).filter(Boolean);
  }

  /**
   * Escape karakter khusus MarkdownV2 Telegram
   */
  _escMd(text) {
    return String(text).replace(/([_*[\]()~`>#+=|{}.!\\-])/g, '\\$1');
  }

  /**
   * Info status rate limit (untuk API /api/telegram-status)
   */
  getStatus() {
    const now = Date.now();
    const status = {};

    for (const [level, limitMs] of Object.entries(RATE_LIMITS)) {
      const lastSent = this.lastSent[level];
      const elapsed  = lastSent ? now - lastSent : null;
      const cooldownLeft = lastSent ? Math.max(0, limitMs - elapsed) : 0;

      status[level] = {
        lastSent:        lastSent ? new Date(lastSent).toISOString() : null,
        cooldownMs:      limitMs,
        cooldownLeftMs:  cooldownLeft,
        cooldownLeftMin: Math.ceil(cooldownLeft / 60000),
        canSend:         cooldownLeft === 0,
      };
    }

    return {
      enabled:       this.enabled,
      chatCount:     this.chatIds.length,
      lastSentLevel: this.lastSentLevel,
      rateLimits:    status,
    };
  }
}

// Singleton
const telegramService = new TelegramService();
module.exports = telegramService;
