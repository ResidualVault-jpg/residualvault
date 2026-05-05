'use strict';

require('dotenv').config();
const pool = require('./db');
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function checkApyAlerts() {
  const startTime = Date.now();
  let triggered = 0;
  let checked = 0;

  try {
    const alerts = await pool.query(`
      SELECT ua.*, u.email, u.first_name, p.name as protocol_name, p.slug, p.chain
      FROM user_apy_alerts ua
      JOIN users u ON u.id = ua.user_id
      JOIN protocols p ON p.id = ua.protocol_id
      WHERE ua.is_active = true
        AND (ua.last_triggered IS NULL OR ua.last_triggered < NOW() - INTERVAL '6 hours')
    `);

    if (alerts.rows.length === 0) {
      console.log('[APY-Alerts] No active alerts to check');
      return { checked: 0, triggered: 0 };
    }

    for (const alert of alerts.rows) {
      checked++;
      const latest = await pool.query(
        'SELECT apy FROM vault_rewards WHERE protocol_id = $1 ORDER BY fetched_at DESC LIMIT 1',
        [alert.protocol_id]
      );

      if (!latest.rows.length) continue;

      const currentApy = parseFloat(latest.rows[0].apy);
      const threshold = parseFloat(alert.threshold);
      let shouldTrigger = false;

      if (alert.direction === 'below' && currentApy <= threshold) shouldTrigger = true;
      if (alert.direction === 'above' && currentApy >= threshold) shouldTrigger = true;

      if (shouldTrigger) {
        triggered++;
        const userName = alert.first_name || 'there';
        const directionText = alert.direction === 'below' ? 'dropped below' : 'risen above';

        try {
          await sgMail.send({
            to: alert.email,
            from: { email: 'support@residualvault.com', name: 'ResidualVault' },
            subject: `APY Alert: ${alert.protocol_name} ${alert.direction === 'below' ? 'dropped' : 'surged'} to ${currentApy.toFixed(2)}%`,
            html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0a1628;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="text-align:center;padding:20px 0;">
      <img src="https://residualvault.com/images/rv-shield.png" alt="ResidualVault" style="width:50px;height:50px;" />
      <h1 style="color:#f0e6d3;font-size:24px;margin:10px 0 0;">ResidualVault</h1>
    </div>
    <div style="background:linear-gradient(135deg,#1a2744,#1e3a5f);border-radius:16px;padding:32px;border:1px solid rgba(135,206,235,0.2);">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="font-size:14px;color:#87ceeb;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px;">APY Alert Triggered</div>
        <h2 style="color:#f0e6d3;font-size:28px;margin:0;">${alert.protocol_name} (${alert.chain})</h2>
      </div>
      <div style="background:rgba(10,22,40,0.5);border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;border:1px solid rgba(135,206,235,0.1);">
        <div style="color:#87ceeb;font-size:14px;margin-bottom:8px;">Current APY</div>
        <div style="font-size:48px;font-weight:bold;background:linear-gradient(135deg,#3ecfcf,#6c63ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">${currentApy.toFixed(2)}%</div>
      </div>
      <p style="color:#87ceeb;font-size:16px;line-height:1.6;text-align:center;">
        Hey ${userName}, ${alert.protocol_name}'s APY has ${directionText} your ${threshold.toFixed(2)}% threshold.
      </p>
      <div style="text-align:center;margin-top:24px;">
        <a href="https://residualvault.com/protocol/${alert.slug}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#e63946,#3b82f6);color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">View ${alert.protocol_name}</a>
      </div>
      <div style="text-align:center;margin-top:16px;">
        <a href="https://residualvault.com/staking" style="color:#3ecfcf;text-decoration:none;font-size:14px;">Compare with other protocols →</a>
      </div>
    </div>
    <div style="text-align:center;padding:24px 0;color:#87ceeb;font-size:12px;">
      <p>You're receiving this because you set an APY alert on ResidualVault.</p>
      <p style="color:#4a6fa5;">© ${new Date().getFullYear()} Residual Vault, LLC. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`
          });
          console.log(`[APY-Alerts] Triggered: ${alert.email} — ${alert.protocol_name} ${directionText} ${threshold}% (now ${currentApy.toFixed(2)}%)`);
        } catch (emailErr) {
          console.error(`[APY-Alerts] Email failed for ${alert.email}:`, emailErr.message);
        }

        await pool.query(
          'UPDATE user_apy_alerts SET last_triggered = NOW() WHERE id = $1',
          [alert.id]
        );
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[APY-Alerts] Done: checked ${checked} alerts, triggered ${triggered} in ${duration}ms`);
    return { checked, triggered, duration };
  } catch (err) {
    console.error('[APY-Alerts] Fatal error:', err.message);
    return { checked, triggered, error: err.message };
  }
}

module.exports = checkApyAlerts;

if (require.main === module) {
  checkApyAlerts().then(() => process.exit(0)).catch(() => process.exit(1));
}
