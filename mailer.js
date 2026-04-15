const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendContentAlert(agent, platform, count) {
  try {
    await sgMail.send({
      to: process.env.NOTIFY_EMAIL,
      from: process.env.EMAIL_FROM,
      subject: `New content queued for approval — ${count} item(s)`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #6c63ff; padding: 24px; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">ResidualVault</h1>
            <p style="color: rgba(255,255,255,0.8); margin: 4px 0 0;">Content Approval Alert</p>
          </div>
          <div style="background: #16161d; padding: 24px; border-radius: 0 0 12px 12px; border: 1px solid #2a2a3a;">
            <p style="color: #ccc;">New content has been queued for your approval:</p>
            <div style="background: #1a1a2e; border-radius: 8px; padding: 16px; margin: 16px 0;">
              <p style="color: #fff; margin: 0;"><strong>Agent:</strong> ${agent}</p>
              <p style="color: #fff; margin: 8px 0 0;"><strong>Platform:</strong> ${platform}</p>
              <p style="color: #fff; margin: 8px 0 0;"><strong>Items pending:</strong> ${count}</p>
            </div>
            <a href="http://residualvault.com/dashboard" style="display: inline-block; background: #6c63ff; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 8px;">
              Review Content
            </a>
          </div>
        </div>
      `
    });
    console.log('[Mailer] Content alert sent to', process.env.NOTIFY_EMAIL);
  } catch (err) {
    console.error('[Mailer] Failed:', err.message);
  }
}

async function sendDailyReport(stats) {
  try {
    await sgMail.send({
      to: process.env.NOTIFY_EMAIL,
      from: process.env.EMAIL_FROM,
      subject: `ResidualVault Daily Report — ${new Date().toLocaleDateString()}`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #6c63ff; padding: 24px; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">ResidualVault</h1>
            <p style="color: rgba(255,255,255,0.8); margin: 4px 0 0;">Daily Performance Report</p>
          </div>
          <div style="background: #16161d; padding: 24px; border-radius: 0 0 12px 12px; border: 1px solid #2a2a3a;">
            <div style="display: grid; gap: 12px;">
              <div style="background: #1a1a2e; border-radius: 8px; padding: 16px;">
                <p style="color: #888; margin: 0; font-size: 13px;">CONTENT QUEUE</p>
                <p style="color: #fff; margin: 8px 0 0; font-size: 24px; font-weight: 700;">${stats.pending} pending approval</p>
              </div>
              <div style="background: #1a1a2e; border-radius: 8px; padding: 16px;">
                <p style="color: #888; margin: 0; font-size: 13px;">APPROVED TODAY</p>
                <p style="color: #3ecfcf; margin: 8px 0 0; font-size: 24px; font-weight: 700;">${stats.approved}</p>
              </div>
            </div>
            <a href="http://residualvault.com/dashboard" style="display: inline-block; background: #6c63ff; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px;">
              Open Dashboard
            </a>
          </div>
        </div>
      `
    });
    console.log('[Mailer] Daily report sent');
  } catch (err) {
    console.error('[Mailer] Daily report failed:', err.message);
  }
}

module.exports = { sendContentAlert, sendDailyReport };
