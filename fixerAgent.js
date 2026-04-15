require('dotenv').config();
const pool = require('./db');
const { execSync } = require('child_process');

async function getLatestReport() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS qa_reports (id SERIAL PRIMARY KEY, report JSONB, status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW(), fixed_at TIMESTAMP)`);
    const result = await pool.query("SELECT * FROM qa_reports WHERE status='pending' ORDER BY created_at DESC LIMIT 1");
    return result.rows[0] || null;
  } catch (err) { console.error('[Fixer] DB error:', err.message); return null; }
}

async function sendDashboardAlert(unfixable) {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS system_alerts (id SERIAL PRIMARY KEY, type VARCHAR(50), message TEXT, details JSONB, resolved BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT NOW())`);
    for (const issue of unfixable) {
      await pool.query("INSERT INTO system_alerts (type, message, details) VALUES ($1, $2, $3)",
        ['QA_UNFIXABLE', issue.issue || issue.action, JSON.stringify(issue)]);
    }
    console.log(`[Fixer] ⚠️ ${unfixable.length} unfixable issues sent to dashboard`);
  } catch (err) { console.error('[Fixer] Alert failed:', err.message); }
}

async function runFixer() {
  console.log('[Fixer Agent] 🔧 Starting...');
  const report = await getLatestReport();
  if (!report) { console.log('[Fixer] No pending reports. Run qaAgent first.'); return; }

  const issues = report.report?.issues || {};
  const total = report.report?.summary?.totalIssues || 0;
  if (total === 0) { console.log('[Fixer] ✅ No issues!'); await pool.query("UPDATE qa_reports SET status='processed', fixed_at=NOW() WHERE id=$1", [report.id]); return; }

  console.log(`[Fixer] ${total} issues to address...\n`);
  const fixed = [], unfixable = [];

  // Fix services
  for (const s of (issues.services || [])) {
    try {
      execSync(`pm2 restart ${s.service} --update-env 2>/dev/null`);
      fixed.push({ ...s, action: `Restarted ${s.service}` });
    } catch (err) { unfixable.push({ ...s, action: `Restart failed: ${err.message}` }); }
  }

  // Fix database
  for (const d of (issues.database || [])) {
    try {
      if (d.issue.includes('expired content')) {
        const r = await pool.query("DELETE FROM content_posts WHERE scheduled_date < CURRENT_DATE AND status NOT IN ('published')");
        fixed.push({ ...d, action: `Deleted ${r.rowCount} expired posts` });
      } else { unfixable.push({ ...d, action: 'Needs manual fix' }); }
    } catch (err) { unfixable.push({ ...d, action: err.message }); }
  }

  // Fix API/page errors — restart rv-api
  for (const a of [...(issues.apis || []), ...(issues.pages || [])]) {
    if (a.issue?.includes('502') || a.issue?.includes('server error') || a.issue?.includes('ECONNREFUSED')) {
      try {
        execSync('pm2 restart rv-api --update-env 2>/dev/null');
        execSync('systemctl reload nginx 2>/dev/null');
        fixed.push({ ...a, action: 'Restarted rv-api + reloaded nginx' });
      } catch (err) { unfixable.push({ ...a, action: err.message }); }
    } else { unfixable.push({ ...a, action: 'Requires manual investigation' }); }
  }

  // Protocol and other issues go to dashboard
  for (const p of (issues.protocols || [])) unfixable.push({ ...p, action: 'Protocol issue needs manual review' });

  console.log('\n====== FIXER SUMMARY ======');
  console.log(`✅ Fixed: ${fixed.length}`);
  fixed.forEach(f => console.log(`  ✅ ${f.action}`));
  console.log(`⚠️  Unfixable: ${unfixable.length}`);
  unfixable.forEach(u => console.log(`  ⚠️  ${u.issue}: ${u.action}`));

  if (unfixable.length) await sendDashboardAlert(unfixable);
  await pool.query("UPDATE qa_reports SET status='processed', fixed_at=NOW(), report=report||$1 WHERE id=$2",
    [JSON.stringify({ fixResults: { fixed, unfixable } }), report.id]);
  console.log('\n[Fixer] Complete!');
}

module.exports = { runFixer };
if (require.main === module) { runFixer().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); }); }
