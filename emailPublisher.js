'use strict';

require('dotenv').config();
const sgMail = require('@sendgrid/mail');
const pool   = require('./db');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const EMAIL_FROM = {
  email: process.env.EMAIL_FROM || 'support@residualvault.com',
  name:  'ResidualVault',
};

function renderNewsletterHTML(newsletter) {
  const quickWinsHTML = (newsletter.quickWins || [])
    .map(w => `
      <tr>
        <td style="padding: 8px 16px; color: #ccc; font-size: 15px; border-left: 3px solid #3ecfcf;">
          ${w.tip}
        </td>
      </tr>
      <tr><td style="height: 8px;"></td></tr>
    `).join('');

  const spotlight = newsletter.protocolSpotlight || {};

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background-color: #0a0a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0f;">
    <tr>
      <td align="center" style="padding: 20px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%;">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1a 100%); border: 1px solid #2a2a3a; border-radius: 16px 16px 0 0; padding: 32px 24px; text-align: center;">
              <img src="https://residualvault.com/images/rv-shield.png" alt="ResidualVault" width="48" height="48" style="display: block; margin: 0 auto 12px;">
              <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 700;">ResidualVault</h1>
              <p style="color: #3ecfcf; font-size: 13px; margin: 4px 0 0; text-transform: uppercase; letter-spacing: 1.5px;">Staking Intelligence Weekly</p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="background: #16161d; border-left: 1px solid #2a2a3a; border-right: 1px solid #2a2a3a; padding: 24px 24px 8px;">
              <p style="color: #ccc; font-size: 15px; line-height: 1.6; margin: 0;">${newsletter.greeting || 'Hey there,'}</p>
            </td>
          </tr>

          <!-- Main Feature -->
          <tr>
            <td style="background: #16161d; border-left: 1px solid #2a2a3a; border-right: 1px solid #2a2a3a; padding: 16px 24px;">
              <h2 style="color: #ffffff; font-size: 20px; margin: 0 0 16px; font-weight: 600;">${(newsletter.mainFeature || {}).headline || ''}</h2>
              <p style="color: #ccc; font-size: 15px; line-height: 1.7; margin: 0 0 20px;">${(newsletter.mainFeature || {}).body || ''}</p>
              <a href="${(newsletter.mainFeature || {}).ctaUrl || 'https://residualvault.com'}" style="display: inline-block; background: linear-gradient(135deg, #3ecfcf, #6c63ff); color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">${(newsletter.mainFeature || {}).cta || 'Explore Now'}</a>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="background: #16161d; border-left: 1px solid #2a2a3a; border-right: 1px solid #2a2a3a; padding: 0 24px;">
              <hr style="border: none; border-top: 1px solid #2a2a3a; margin: 24px 0;">
            </td>
          </tr>

          <!-- Quick Wins -->
          <tr>
            <td style="background: #16161d; border-left: 1px solid #2a2a3a; border-right: 1px solid #2a2a3a; padding: 0 24px 16px;">
              <h3 style="color: #3ecfcf; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 16px;">Quick Wins</h3>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${quickWinsHTML}
              </table>
            </td>
          </tr>

          <!-- Protocol Spotlight -->
          ${spotlight.name ? `
          <tr>
            <td style="background: #16161d; border-left: 1px solid #2a2a3a; border-right: 1px solid #2a2a3a; padding: 0 24px 16px;">
              <div style="background: #1a1a2e; border: 1px solid #2a2a3a; border-radius: 12px; padding: 20px;">
                <h3 style="color: #3ecfcf; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 12px;">Protocol Spotlight</h3>
                <h4 style="color: #ffffff; font-size: 18px; margin: 0 0 8px;">${spotlight.name}</h4>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom: 12px;">
                  <tr>
                    <td style="color: #3ecfcf; font-size: 22px; font-weight: 700; padding-right: 20px;">${spotlight.apy || ''} APY</td>
                    <td style="color: #888; font-size: 13px;">${spotlight.chain || ''} &middot; ${spotlight.riskLevel || ''} risk</td>
                  </tr>
                </table>
                <p style="color: #ccc; font-size: 14px; line-height: 1.5; margin: 0;">${spotlight.description || ''}</p>
              </div>
            </td>
          </tr>
          ` : ''}

          <!-- Market Context -->
          ${newsletter.marketContext ? `
          <tr>
            <td style="background: #16161d; border-left: 1px solid #2a2a3a; border-right: 1px solid #2a2a3a; padding: 8px 24px 16px;">
              <p style="color: #888; font-size: 14px; font-style: italic; line-height: 1.5; margin: 0;">${newsletter.marketContext}</p>
            </td>
          </tr>
          ` : ''}

          <!-- Closing -->
          <tr>
            <td style="background: #16161d; border-left: 1px solid #2a2a3a; border-right: 1px solid #2a2a3a; padding: 16px 24px;">
              <p style="color: #ccc; font-size: 15px; line-height: 1.6; margin: 0;">${newsletter.closing || ''}</p>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="background: #16161d; border-left: 1px solid #2a2a3a; border-right: 1px solid #2a2a3a; padding: 8px 24px 24px; text-align: center;">
              <a href="https://residualvault.com" style="display: inline-block; background: linear-gradient(135deg, #3ecfcf, #6c63ff); color: #fff; padding: 14px 36px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px;">Compare 156+ Protocols Free</a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background: #0f0f1a; border: 1px solid #2a2a3a; border-top: none; border-radius: 0 0 16px 16px; padding: 20px 24px; text-align: center;">
              <p style="color: #555; font-size: 12px; margin: 0 0 8px;">ResidualVault.com &middot; Staking Intelligence Platform</p>
              <p style="color: #444; font-size: 11px; margin: 0;">
                <a href="https://residualvault.com/unsubscribe?email={{email}}" style="color: #555; text-decoration: underline;">Unsubscribe</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function publishApprovedNewsletters() {
  console.log('[EmailPublisher] Checking for approved newsletters...');

  try {
    const result = await pool.query(`
      SELECT id, title, content, metadata
      FROM generated_content
      WHERE agent_name = 'Email Conductor'
        AND content_type = 'email-newsletter'
        AND metadata->>'status' = 'approved'
        AND NOT EXISTS (
          SELECT 1 FROM email_sends WHERE content_id = generated_content.id AND status = 'sent'
        )
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      console.log('[EmailPublisher] No approved newsletters to send.');
      return { sent: 0 };
    }

    const row = result.rows[0];
    let newsletter;
    try {
      newsletter = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
      if (typeof newsletter === 'string') newsletter = JSON.parse(newsletter);
    } catch (e) {
      console.error('[EmailPublisher] Failed to parse newsletter content:', e.message);
      return { sent: 0, error: 'parse_failed' };
    }

    const subscribers = await pool.query(
      "SELECT id, email, first_name FROM newsletter_subscribers WHERE status = 'active'"
    );

    if (subscribers.rows.length === 0) {
      console.log('[EmailPublisher] No active subscribers.');
      return { sent: 0 };
    }

    console.log(`[EmailPublisher] Sending "${newsletter.subject}" to ${subscribers.rows.length} subscribers...`);

    const html = renderNewsletterHTML(newsletter);
    let sentCount = 0;
    let failCount = 0;

    for (const sub of subscribers.rows) {
      try {
        const personalizedHTML = html.replace(/\{\{email\}\}/g, encodeURIComponent(sub.email));

        const msg = {
          to:      sub.email,
          from:    EMAIL_FROM,
          subject: newsletter.subject || 'ResidualVault Weekly',
          html:    personalizedHTML,
        };

        if (newsletter.previewText) {
          msg.text = newsletter.previewText;
        }

        const response = await sgMail.send(msg);
        const messageId = response[0]?.headers?.['x-message-id'] || null;

        await pool.query(
          `INSERT INTO email_sends (content_id, subscriber_id, subject, status, sendgrid_message_id)
           VALUES ($1, $2, $3, 'sent', $4)`,
          [row.id, sub.id, newsletter.subject, messageId]
        );

        sentCount++;
        console.log(`[EmailPublisher] Sent to ${sub.email}`);

        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        failCount++;
        console.error(`[EmailPublisher] Failed for ${sub.email}: ${err.message}`);

        await pool.query(
          `INSERT INTO email_sends (content_id, subscriber_id, subject, status)
           VALUES ($1, $2, $3, 'failed')`,
          [row.id, sub.id, newsletter.subject]
        );
      }
    }

    await pool.query(
      `UPDATE generated_content SET metadata = jsonb_set(metadata, '{status}', '"published"') WHERE id = $1`,
      [row.id]
    );

    console.log(`[EmailPublisher] Done. Sent: ${sentCount}, Failed: ${failCount}`);
    return { sent: sentCount, failed: failCount, subject: newsletter.subject };
  } catch (err) {
    console.error('[EmailPublisher] Error:', err.message);
    return { sent: 0, error: err.message };
  }
}

module.exports = { publishApprovedNewsletters };
