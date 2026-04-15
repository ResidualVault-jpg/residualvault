require('dotenv').config();
const pool = require('./db');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const CHANGE_THRESHOLD = 1.0;

async function checkAPYChanges() {
  try {
    console.log('[APY Alerts] Checking for significant APY changes...');

    const result = await pool.query(`
      SELECT DISTINCT ON (p.id)
        p.id, p.name, p.slug, p.chain,
        vr.apy as current_apy,
        vr.fetched_at
      FROM protocols p
      JOIN vault_rewards vr ON vr.protocol_id = p.id
      ORDER BY p.id, vr.fetched_at DESC
    `);

    const currentAPYs = result.rows;

    for (const protocol of currentAPYs) {
      const previous = await pool.query(`
        SELECT apy FROM vault_rewards
        WHERE protocol_id = $1
        ORDER BY fetched_at DESC
        LIMIT 1 OFFSET 1
      `, [protocol.id]);

      if (!previous.rows.length) continue;

      const prevAPY = parseFloat(previous.rows[0].apy);
      const currAPY = parseFloat(protocol.current_apy);
      const changePercent = ((currAPY - prevAPY) / prevAPY) * 100;

      if (Math.abs(changePercent) >= CHANGE_THRESHOLD) {
        const direction = changePercent > 0 ? 'up' : 'down';

        await pool.query(
          'INSERT INTO apy_alerts (protocol_id, previous_apy, new_apy, change_percent, direction) VALUES ($1, $2, $3, $4, $5)',
          [protocol.id, prevAPY, currAPY, changePercent.toFixed(4), direction]
        );

        console.log(`[APY Alerts] ${protocol.name} APY ${direction} ${Math.abs(changePercent).toFixed(2)}% (${prevAPY}% → ${currAPY}%)`);

        await sendAlertEmails(protocol, prevAPY, currAPY, changePercent, direction);
      }
    }

    console.log('[APY Alerts] Check complete.');
  } catch (err) {
    console.error('[APY Alerts] Error:', err.message);
  }
}

async function sendAlertEmails(protocol, prevAPY, currAPY, changePercent, direction) {
  try {
    const users = await pool.query(`
      SELECT u.email, u.first_name
      FROM users u
      WHERE u.plan != 'free'
      OR u.id IN (
        SELECT user_id FROM user_alert_preferences WHERE enabled = true
      )
    `);

    if (!users.rows.length) return;

    const isUp = direction === 'up';
    const emoji = isUp ? '📈' : '📉';
    const color = isUp ? '#3ecfcf' : '#ef4444';
    const changeStr = `${isUp ? '+' : ''}${changePercent.toFixed(2)}%`;

    for (const user of users.rows) {
      await sgMail.send({
        to: user.email,
        from: process.env.EMAIL_FROM,
        subject: `${emoji} ${protocol.name} APY ${direction === 'up' ? 'increased' : 'decreased'} to ${currAPY.toFixed(2)}%`,
        html: `
          <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; background: #0f0f13; padding: 24px; border-radius: 16px;">
            <div style="background: linear-gradient(135deg, #6c63ff, #3ecfcf); padding: 24px; border-radius: 12px; margin-bottom: 24px;">
              <h1 style="color: white; margin: 0; font-size: 22px;">ResidualVault</h1>
              <p style="color: rgba(255,255,255,0.8); margin: 4px 0 0; font-size: 14px;">APY Change Alert</p>
            </div>

            <div style="background: #16161d; border: 1px solid #2a2a3a; border-radius: 12px; padding: 24px; margin-bottom: 20px;">
              <p style="color: #888; margin: 0 0 8px; font-size: 13px;">Hi ${user.first_name || 'there'},</p>
              <p style="color: #ccc; margin: 0 0 20px; font-size: 15px;">
                There has been a significant APY change for <strong style="color: #fff;">${protocol.name}</strong> (${protocol.chain}).
              </p>

              <div style="display: flex; gap: 16px; margin-bottom: 20px;">
                <div style="flex: 1; background: #0f0f13; border-radius: 10px; padding: 16px; text-align: center;">
                  <div style="color: #888; font-size: 12px; margin-bottom: 4px;">PREVIOUS APY</div>
                  <div style="color: #aaa; font-size: 24px; font-weight: 800;">${prevAPY.toFixed(2)}%</div>
                </div>
                <div style="flex: 1; background: #0f0f13; border-radius: 10px; padding: 16px; text-align: center;">
                  <div style="color: #888; font-size: 12px; margin-bottom: 4px;">NEW APY</div>
                  <div style="color: ${color}; font-size: 24px; font-weight: 800;">${currAPY.toFixed(2)}%</div>
                </div>
                <div style="flex: 1; background: #0f0f13; border-radius: 10px; padding: 16px; text-align: center;">
                  <div style="color: #888; font-size: 12px; margin-bottom: 4px;">CHANGE</div>
                  <div style="color: ${color}; font-size: 24px; font-weight: 800;">${changeStr}</div>
                </div>
              </div>

              <a href="http://residualvault.com" style="display: block; text-align: center; background: #6c63ff; color: white; padding: 14px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 15px;">
                View All Staking Rates →
              </a>
            </div>

            <p style="text-align: center; color: #444; font-size: 12px; margin: 0;">
              You are receiving this because you have a ResidualVault account.<br/>
              <a href="http://residualvault.com/account" style="color: #6c63ff;">Manage preferences</a>
            </p>
          </div>
        `
      });
      console.log(`[APY Alerts] Alert sent to ${user.email}`);
    }
  } catch (err) {
    console.error('[APY Alerts] Email failed:', err.message);
  }
}

module.exports = { checkAPYChanges };
