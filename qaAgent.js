require('dotenv').config();
const axios = require('axios');
const pool = require('./db');

const BASE_URL = 'https://residualvault.com';
const API_BASE = 'https://residualvault.com/api/v1';

const PAGES = [
  { name: 'Homepage', path: '/' },
  { name: 'Staking Options', path: '/staking' },
  { name: 'Leaderboard', path: '/leaderboard' },
  { name: 'Education Hub', path: '/education' },
  { name: 'Blog', path: '/blog' },
  { name: 'Calculator', path: '/calculator' },
  { name: 'Pricing', path: '/pricing' },
  { name: 'Contact', path: '/contact' },
  { name: 'Login', path: '/login' },
  { name: 'Register', path: '/register' },
  { name: 'Privacy Policy', path: '/privacy' },
  { name: 'Terms', path: '/terms' },
];

const API_ENDPOINTS = [
  { name: 'Protocols List', url: `${API_BASE}/staking/options`, check: (d) => d?.data?.options?.length > 0 ? null : 'No protocols returned' },
  { name: 'Leaderboard API', url: `${BASE_URL}/api/leaderboard`, check: (d) => d?.data?.length > 0 ? null : 'Empty leaderboard' },
  { name: 'Education Courses', url: `${API_BASE}/education/courses`, check: (d) => d?.data?.courses?.length > 0 ? null : 'No courses returned' },
  { name: 'Protocols All', url: `${BASE_URL}/api/protocols/all`, check: (d) => Array.isArray(d) && d.length > 0 ? null : 'Empty protocols' },
  { name: 'Persistence Detail', url: `${API_BASE}/staking/options/persistence`, check: (d) => {
    const o = d?.data?.option;
    if (!o) return 'Protocol not found';
    if (!parseFloat(o.current_apy || o.apy)) return `APY is 0 (got: ${o.current_apy})`;
    if (!o.stakeUrl && !o.stake_url) return 'stake_url missing — Stake Now disabled';
    return null;
  }},
  { name: 'Cosmos Detail', url: `${API_BASE}/staking/options/cosmos`, check: (d) => {
    const o = d?.data?.option;
    if (!o) return 'Protocol not found';
    if (!parseFloat(o.current_apy || o.apy)) return `APY is 0`;
    if (!o.stakeUrl && !o.stake_url) return 'stake_url missing';
    return null;
  }},
  { name: 'Ethereum Detail', url: `${API_BASE}/staking/options/ethereum`, check: (d) => {
    const o = d?.data?.option;
    if (!o) return 'Protocol not found';
    if (!o.stakeUrl && !o.stake_url) return 'stake_url missing';
    return null;
  }},
];

const PROTOCOL_SAMPLES = ['persistence','cosmos','ethereum','solana','lido','rocket-pool','cardano','polkadot','avalanche','near'];

async function checkPage(page) {
  const start = Date.now();
  try {
    const res = await axios.get(`${BASE_URL}${page.path}`, { timeout: 15000, validateStatus: () => true });
    const ms = Date.now() - start;
    if (res.status >= 400) return { page: page.name, path: page.path, status: 'FAIL', issue: `HTTP ${res.status}`, responseTime: ms };
    return { page: page.name, path: page.path, status: 'OK', responseTime: ms };
  } catch (err) {
    return { page: page.name, path: page.path, status: 'FAIL', issue: err.message, responseTime: Date.now() - start };
  }
}

async function checkAPI(endpoint) {
  const start = Date.now();
  try {
    const res = await axios.get(endpoint.url, { timeout: 15000, validateStatus: () => true });
    const ms = Date.now() - start;
    if (res.status >= 500) return { name: endpoint.name, url: endpoint.url, status: 'FAIL', issue: `HTTP ${res.status}`, responseTime: ms };
    const issue = endpoint.check ? endpoint.check(res.data) : null;
    if (issue) return { name: endpoint.name, url: endpoint.url, status: 'FAIL', issue, responseTime: ms };
    return { name: endpoint.name, url: endpoint.url, status: 'OK', responseTime: ms };
  } catch (err) {
    return { name: endpoint.name, url: endpoint.url, status: 'FAIL', issue: err.message, responseTime: Date.now() - start };
  }
}

async function checkProtocolSamples() {
  const issues = [];
  for (const slug of PROTOCOL_SAMPLES) {
    try {
      const res = await axios.get(`${API_BASE}/staking/options/${slug}`, { timeout: 10000 });
      const o = res.data?.data?.option;
      if (!o) { issues.push({ slug, issue: 'Protocol not found' }); continue; }
      if (!parseFloat(o.current_apy || o.apy)) issues.push({ slug, issue: 'APY is 0 — calculator shows $0' });
      if (!o.stakeUrl && !o.stake_url) issues.push({ slug, issue: 'No stake_url — Stake Now button disabled' });
    } catch (err) {
      issues.push({ slug, issue: `Request failed: ${err.message}` });
    }
  }
  return issues;
}

async function checkPM2() {
  const { execSync } = require('child_process');
  try {
    const procs = JSON.parse(execSync('pm2 jlist 2>/dev/null').toString());
    const issues = [];
    for (const p of procs) {
      if (p.pm2_env?.status !== 'online') issues.push({ service: p.name, issue: `Status: ${p.pm2_env?.status}` });
      if (p.pm2_env?.restart_time > 100) issues.push({ service: p.name, issue: `Very high restarts: ${p.pm2_env.restart_time}` });
    }
    return issues;
  } catch (err) {
    return [{ service: 'PM2', issue: err.message }];
  }
}

async function checkDatabase() {
  const issues = [];
  try {
    const missing = await pool.query("SELECT COUNT(*) FROM protocols WHERE stake_url IS NULL");
    if (parseInt(missing.rows[0].count) > 0) issues.push({ check: 'DB', issue: `${missing.rows[0].count} protocols missing stake_url` });
    const noApy = await pool.query("SELECT COUNT(*) FROM protocols p LEFT JOIN vault_rewards vr ON vr.protocol_id=p.id WHERE vr.id IS NULL");
    if (parseInt(noApy.rows[0].count) > 0) issues.push({ check: 'DB', issue: `${noApy.rows[0].count} protocols have no APY data` });
    const expired = await pool.query("SELECT COUNT(*) FROM content_posts WHERE scheduled_date < CURRENT_DATE AND status NOT IN ('published')");
    if (parseInt(expired.rows[0].count) > 0) issues.push({ check: 'DB', issue: `${expired.rows[0].count} expired content posts need cleanup` });
  } catch (err) {
    issues.push({ check: 'DB', issue: err.message });
  }
  return issues;
}

async function saveReport(report) {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS qa_reports (id SERIAL PRIMARY KEY, report JSONB, status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW(), fixed_at TIMESTAMP)`);
    await pool.query("INSERT INTO qa_reports (report) VALUES ($1)", [JSON.stringify(report)]);
    console.log('[QA] ✅ Report saved to database');
  } catch (err) {
    console.error('[QA] Failed to save report:', err.message);
  }
}

async function runQA() {
  console.log('[QA Agent] 🤖 Starting full site scan...\n');
  const [pageResults, apiResults, protocolIssues, serviceIssues, dbIssues] = await Promise.all([
    Promise.all(PAGES.map(checkPage)),
    Promise.all(API_ENDPOINTS.map(checkAPI)),
    checkProtocolSamples(),
    checkPM2(),
    checkDatabase()
  ]);

  const failedPages = pageResults.filter(r => r.status === 'FAIL');
  const failedAPIs = apiResults.filter(r => r.status === 'FAIL');
  const totalIssues = failedPages.length + failedAPIs.length + protocolIssues.length + serviceIssues.length + dbIssues.length;

  const report = {
    timestamp: new Date().toISOString(),
    summary: { pagesChecked: PAGES.length, pagesFailed: failedPages.length, apisChecked: API_ENDPOINTS.length, apisFailed: failedAPIs.length, protocolIssues: protocolIssues.length, serviceIssues: serviceIssues.length, dbIssues: dbIssues.length, totalIssues },
    issues: { pages: failedPages, apis: failedAPIs, protocols: protocolIssues, services: serviceIssues, database: dbIssues },
    passing: { pages: pageResults.filter(r => r.status === 'OK').map(r => r.page), apis: apiResults.filter(r => r.status === 'OK').map(r => r.name) }
  };

  console.log('====== QA SCAN COMPLETE ======');
  console.log(`Total Issues: ${totalIssues}`);
  if (failedPages.length) { console.log('\n❌ Pages:'); failedPages.forEach(p => console.log(`  ${p.page}: ${p.issue}`)); }
  if (failedAPIs.length) { console.log('\n❌ APIs:'); failedAPIs.forEach(a => console.log(`  ${a.name}: ${a.issue}`)); }
  if (protocolIssues.length) { console.log('\n❌ Protocols:'); protocolIssues.forEach(p => console.log(`  ${p.slug}: ${p.issue}`)); }
  if (serviceIssues.length) { console.log('\n❌ Services:'); serviceIssues.forEach(s => console.log(`  ${s.service}: ${s.issue}`)); }
  if (dbIssues.length) { console.log('\n❌ Database:'); dbIssues.forEach(d => console.log(`  ${d.issue}`)); }
  if (totalIssues === 0) console.log('\n✅ ALL CHECKS PASSED!');
  console.log('\n✅ Passing pages:', report.passing.pages.join(', '));

  await saveReport(report);
  return report;
}

module.exports = { runQA };
if (require.main === module) { runQA().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); }); }
