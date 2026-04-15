require('dotenv').config();
const https = require('https');
const http = require('http');
const pool = require('./db');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const MONITORS = [
  { name: 'ResidualVault Main', url: 'https://residualvault.com' },
  { name: 'ResidualVault API', url: 'http://64.23.240.10/api/protocols' },
  { name: 'ResidualVault Staking', url: 'http://64.23.240.10/api/protocols/all' },
];

let downAlerts = {};

async function checkUrl(monitor) {
  return new Promise((resolve) => {
    const start = Date.now();
    const protocol = monitor.url.startsWith('https') ? https : http;

    const req = protocol.get(monitor.url, { timeout: 10000 }, (res) => {
      const responseTime = Date.now() - start;
      resolve({
        status: res.statusCode >= 200 && res.statusCode < 400 ? 'up' : 'down',
        statusCode: res.statusCode,
        responseTime,
        error: null
      });
    });

    req.on('error', (err) => {
      resolve({
        status: 'down',
        statusCode: 0,
        responseTime: Date.now() - start,
        error: err.message
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        status: 'down',
        statusCode: 0,
        responseTime: 10000,
        error: 'Request timed out'
      });
    });
  });
}

async function sendDownAlert(monitor, result) {
  try {
    await sgMail.send({
      to: process.env.NOTIFY_EMAIL,
      from: process.env.EMAIL_FROM,
      subject: `🚨 ALERT: ${monitor.name} is DOWN`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; background: #0f0f13; padding: 24px; border-radius: 16px;">
          <div style="background: linear-gradient(135deg, #ef4444, #dc2626); padding: 24px; border-radius: 12px; margin-bottom: 24px;">
            <h1 style="color: white; margin: 0; font-size: 22px;">🚨 ResidualVault</h1>
            <p style="color: rgba(255,255,255,0.8); margin: 4px 0 0; font-size: 14px;">Site Down Alert</p>
          </div>
          <div style="background: #16161d; border: 1px solid #2a2a3a; border-radius: 12px; padding: 24px;">
            <p style="color: #ef4444; font-size: 18px; font-weight: 700; margin: 0 0 16px;">⚠️ ${monitor.name} is not responding</p>
            <div style="background: #0f0f13; border-radius: 10px; padding: 16px; margin-bottom: 12px;">
              <div style="color: #555; font-size: 12px; margin-bottom: 4px;">URL</div>
              <div style="color: #fff; font-family: monospace;">${monitor.url}</div>
            </div>
            <div style="background: #0f0f13; border-radius: 10px; padding: 16px; margin-bottom: 12px;">
              <div style="color: #555; font-size: 12px; margin-bottom: 4px;">ERROR</div>
              <div style="color: #ef4444; font-family: monospace;">${result.error || `HTTP ${result.statusCode}`}</div>
            </div>
            <div style="background: #0f0f13; border-radius: 10px; padding: 16px;">
              <div style="color: #555; font-size: 12px; margin-bottom: 4px;">TIME</div>
              <div style="color: #fff;">${new Date().toLocaleString('en-US', { timeZone: 'America/Denver' })} MST</div>
            </div>
          </div>
        </div>
      `
    });
    console.log(`[Uptime] Down alert sent for ${monitor.name}`);
  } catch (err) {
    console.error('[Uptime] Alert email failed:', err.message);
  }
}

async function sendRecoveryAlert(monitor, result) {
  try {
    await sgMail.send({
      to: process.env.NOTIFY_EMAIL,
      from: process.env.EMAIL_FROM,
      subject: `✅ RECOVERED: ${monitor.name} is back online`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; background: #0f0f13; padding: 24px; border-radius: 16px;">
          <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 24px; border-radius: 12px; margin-bottom: 24px;">
            <h1 style="color: white; margin: 0; font-size: 22px;">✅ ResidualVault</h1>
            <p style="color: rgba(255,255,255,0.8); margin: 4px 0 0; font-size: 14px;">Site Recovery Alert</p>
          </div>
          <div style="background: #16161d; border: 1px solid #2a2a3a; border-radius: 12px; padding: 24px;">
            <p style="color: #10b981; font-size: 18px; font-weight: 700; margin: 0 0 16px;">✅ ${monitor.name} is back online</p>
            <div style="background: #0f0f13; border-radius: 10px; padding: 16px; margin-bottom: 12px;">
              <div style="color: #555; font-size: 12px; margin-bottom: 4px;">RESPONSE TIME</div>
              <div style="color: #10b981; font-size: 24px; font-weight: 800;">${result.responseTime}ms</div>
            </div>
            <div style="background: #0f0f13; border-radius: 10px; padding: 16px;">
              <div style="color: #555; font-size: 12px; margin-bottom: 4px;">RECOVERED AT</div>
              <div style="color: #fff;">${new Date().toLocaleString('en-US', { timeZone: 'America/Denver' })} MST</div>
            </div>
          </div>
        </div>
      `
    });
    console.log(`[Uptime] Recovery alert sent for ${monitor.name}`);
  } catch (err) {
    console.error('[Uptime] Recovery email failed:', err.message);
  }
}

async function runChecks() {
  for (const monitor of MONITORS) {
    const result = await checkUrl(monitor);
    
    await pool.query(
      'INSERT INTO uptime_logs (url, status, response_time_ms, status_code, error_message) VALUES ($1, $2, $3, $4, $5)',
      [monitor.url, result.status, result.responseTime, result.statusCode, result.error]
    );

    if (result.status === 'down') {
      if (!downAlerts[monitor.name]) {
        downAlerts[monitor.name] = true;
        console.log(`[Uptime] 🚨 ${monitor.name} is DOWN - sending alert`);
        await sendDownAlert(monitor, result);
      } else {
        console.log(`[Uptime] ${monitor.name} still down - alert already sent`);
      }
    } else {
      if (downAlerts[monitor.name]) {
        delete downAlerts[monitor.name];
        console.log(`[Uptime] ✅ ${monitor.name} recovered - sending recovery alert`);
        await sendRecoveryAlert(monitor, result);
      } else {
        console.log(`[Uptime] ✅ ${monitor.name} - ${result.responseTime}ms`);
      }
    }
  }
}

module.exports = { runChecks };
