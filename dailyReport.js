require('dotenv').config();
const pool = require('./db');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendDailyReport() {
  try {
    const users = await pool.query('SELECT COUNT(*) FROM users');
    const freeUsers = await pool.query("SELECT COUNT(*) FROM users WHERE plan='free'");
    const paidUsers = await pool.query("SELECT COUNT(*) FROM users WHERE plan != 'free'");
    const pendingContent = await pool.query("SELECT COUNT(*) FROM content_queue WHERE status='pending'");
    const approvedToday = await pool.query("SELECT COUNT(*) FROM content_queue WHERE status='approved' AND created_at > NOW() - INTERVAL '24 hours'");
    const protocols = await pool.query('SELECT COUNT(*) FROM protocols');
    const liveAPY = await pool.query('SELECT COUNT(DISTINCT protocol_id) FROM vault_rewards');
    const topProtocols = await pool.query(`
      SELECT DISTINCT ON (p.id) p.name, p.chain, vr.apy
      FROM protocols p
      JOIN vault_rewards vr ON vr.protocol_id = p.id
      ORDER BY p.id, vr.fetched_at DESC, vr.apy DESC
      LIMIT 5
    `);
    const sorted = topProtocols.rows.sort((a, b) => b.apy - a.apy);

    const topProtocolsHtml = sorted.map(p => `
      <tr>
        <td style="padding: 8px 12px; color: #fff; font-size: 14px;">${p.name}</td>
        <td style="padding: 8px 12px; color: #6c63ff; font-size: 14px; font-weight: 600;">${p.chain}</td>
        <td style="padding: 8px 12px; color: #3ecfcf; font-size: 14px; font-weight: 700;">${parseFloat(p.apy).toFixed(2)}%</td>
      </tr>
    `).join('');

    await sgMail.send({
      to: process.env.NOTIFY_EMAIL,
      from: process.env.EMAIL_FROM,
      subject: `ResidualVault Daily Report — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; background: #0f0f13; padding: 24px; border-radius: 16px;">
          
          <div style="background: linear-gradient(135deg, #6c63ff, #3ecfcf); padding: 24px; border-radius: 12px; margin-bottom: 24px;">
            <h1 style="color: white; margin: 0; font-size: 22px;">ResidualVault</h1>
            <p style="color: rgba(255,255,255,0.8); margin: 4px 0 0; font-size: 14px;">Daily Performance Report — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
          </div>

          <div style="display: grid; gap: 12px; margin-bottom: 24px;">
            <div style="background: #16161d; border: 1px solid #2a2a3a; border-radius: 12px; padding: 20px; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Total users</div>
                <div style="color: #fff; font-size: 28px; font-weight: 800; margin-top: 4px;">${users.rows[0].count}</div>
              </div>
              <div style="text-align: right;">
                <div style="color: #3ecfcf; font-size: 14px;">${paidUsers.rows[0].count} paid</div>
                <div style="color: #888; font-size: 13px;">${freeUsers.rows[0].count} free</div>
              </div>
            </div>

            <div style="background: #16161d; border: 1px solid #2a2a3a; border-radius: 12px; padding: 20px; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Content queue</div>
                <div style="color: #f59e0b; font-size: 28px; font-weight: 800; margin-top: 4px;">${pendingContent.rows[0].count} pending</div>
              </div>
              <div style="text-align: right;">
                <div style="color: #3ecfcf; font-size: 14px;">${approvedToday.rows[0].count} approved today</div>
              </div>
            </div>

            <div style="background: #16161d; border: 1px solid #2a2a3a; border-radius: 12px; padding: 20px; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Protocols</div>
                <div style="color: #fff; font-size: 28px; font-weight: 800; margin-top: 4px;">${protocols.rows[0].count} total</div>
              </div>
              <div style="text-align: right;">
                <div style="color: #3ecfcf; font-size: 14px;">${liveAPY.rows[0].count} with live APY</div>
              </div>
            </div>
          </div>

          <div style="background: #16161d; border: 1px solid #2a2a3a; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
            <h3 style="color: #fff; margin: 0 0 16px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Top APY protocols right now</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="border-bottom: 1px solid #2a2a3a;">
                  <th style="padding: 8px 12px; text-align: left; color: #555; font-size: 11px; text-transform: uppercase;">Protocol</th>
                  <th style="padding: 8px 12px; text-align: left; color: #555; font-size: 11px; text-transform: uppercase;">Chain</th>
                  <th style="padding: 8px 12px; text-align: left; color: #555; font-size: 11px; text-transform: uppercase;">APY</th>
                </tr>
              </thead>
              <tbody>${topProtocolsHtml}</tbody>
            </table>
          </div>

          <div style="text-align: center;">
            <a href="http://64.23.240.10/dashboard" style="display: inline-block; background: #6c63ff; color: white; padding: 12px 28px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px; margin-right: 12px;">
              Approval Dashboard
            </a>
            <a href="http://64.23.240.10" style="display: inline-block; border: 1px solid #2a2a3a; color: #888; padding: 12px 28px; border-radius: 10px; text-decoration: none; font-size: 14px;">
              View Site
            </a>
          </div>

          <p style="text-align: center; color: #444; font-size: 12px; margin-top: 24px;">
            ResidualVault Daily Report — Delivered automatically every day
          </p>
        </div>
      `
    });
    console.log('[Daily Report] Sent successfully');
  } catch (err) {
    console.error('[Daily Report] Failed:', err.message);
  }
}

sendDailyReport();
module.exports = { sendDailyReport };
