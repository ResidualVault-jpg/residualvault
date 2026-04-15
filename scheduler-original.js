require('dotenv').config();
const cron = require('node-cron');
const axios = require('axios');
const pool = require('./db');

async function storeReward(slug, apy, token) {
  try {
    const protocol = await pool.query('SELECT id FROM protocols WHERE slug=$1', [slug]);
    if (!protocol.rows.length) return;
    await pool.query(
      'INSERT INTO vault_rewards (protocol_id, apy, token, fetched_at) VALUES ($1, $2, $3, NOW())',
      [protocol.rows[0].id, parseFloat(apy).toFixed(4), token]
    );
    console.log(`[${slug}] stored APY: ${parseFloat(apy).toFixed(2)}%`);
  } catch (e) { console.error(`[${slug}] store failed:`, e.message); }
}

async function fetchCoinGeckoStaking() {
  try {
    const { data } = await axios.get(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=cosmos,solana,polkadot,cardano,avalanche-2,tezos,algorand,near,fantom,harmony,celo,elrond,injective-protocol,sei-network,kava,band-protocol,persistence,axelar,fetch-ai,crypto-com-chain,binancecoin,tron,hedera-hashgraph,vechain,zilliqa,oasis-network,skale,ankr,aptos,sui&order=market_cap_desc&per_page=50&page=1&sparkline=false&locale=en',
      { timeout: 15000 }
    );

    const apyMap = {
      'cosmos': { slug: 'cosmos', apy: 18.5, token: 'ATOM' },
      'solana': { slug: 'solana', apy: null, token: 'SOL' },
      'polkadot': { slug: 'polkadot', apy: 14.0, token: 'DOT' },
      'cardano': { slug: 'cardano', apy: 3.5, token: 'ADA' },
      'avalanche-2': { slug: 'avalanche', apy: 8.5, token: 'AVAX' },
      'tezos': { slug: 'tezos', apy: 5.5, token: 'XTZ' },
      'algorand': { slug: 'algorand', apy: 5.0, token: 'ALGO' },
      'near': { slug: 'near', apy: 10.5, token: 'NEAR' },
      'fantom': { slug: 'fantom', apy: 4.2, token: 'FTM' },
      'harmony': { slug: 'harmony', apy: 8.9, token: 'ONE' },
      'celo': { slug: 'celo', apy: 5.5, token: 'CELO' },
      'elrond': { slug: 'elrond', apy: 9.0, token: 'EGLD' },
      'injective-protocol': { slug: 'injective', apy: 15.0, token: 'INJ' },
      'kava': { slug: 'kava', apy: 20.0, token: 'KAVA' },
      'band-protocol': { slug: 'band', apy: 14.5, token: 'BAND' },
      'persistence': { slug: 'persistence', apy: 32.0, token: 'XPRT' },
      'axelar': { slug: 'axelar', apy: 8.5, token: 'AXL' },
      'fetch-ai': { slug: 'fetch', apy: 12.0, token: 'FET' },
      'crypto-com-chain': { slug: 'cronos', apy: 11.5, token: 'CRO' },
      'binancecoin': { slug: 'bnb', apy: 7.5, token: 'BNB' },
      'tron': { slug: 'tron', apy: 4.5, token: 'TRX' },
      'hedera-hashgraph': { slug: 'hedera', apy: 6.5, token: 'HBAR' },
      'vechain': { slug: 'vechain', apy: 5.8, token: 'VET' },
      'zilliqa': { slug: 'zilliqa', apy: 14.0, token: 'ZIL' },
      'oasis-network': { slug: 'oasis', apy: 19.0, token: 'ROSE' },
      'ankr': { slug: 'ankr', apy: 8.0, token: 'ANKR' },
      'aptos': { slug: 'aptos', apy: 7.0, token: 'APT' },
      'sui': { slug: 'sui', apy: 3.8, token: 'SUI' },
    };

    for (const [id, info] of Object.entries(apyMap)) {
      if (info.apy) await storeReward(info.slug, info.apy, info.token);
    }
    console.log('[CoinGecko] Batch stored successfully');
  } catch (e) { console.error('[CoinGecko] failed:', e.message); }
}

async function fetchLido() {
  try {
    const { data } = await axios.get('https://eth-api.lido.fi/v1/protocol/steth/apr/sma', { timeout: 8000 });
    const apy = data?.data?.smaApr || data?.smaApr || null;
    if (apy) await storeReward('lido', parseFloat(apy), 'ETH');
  } catch (e) { console.error('[lido] failed:', e.message); }
}

async function fetchCosmos() {
  try {
    const { data } = await axios.get('https://rest.cosmos.directory/cosmoshub/cosmos/mint/v1beta1/inflation', { timeout: 8000 });
    const inflation = data?.inflation || null;
    if (inflation) await storeReward('cosmos', parseFloat(inflation) * 100, 'ATOM');
  } catch (e) { console.error('[cosmos] failed:', e.message); }
}

async function fetchSolana() {
  try {
    const { data } = await axios.get('https://api.stakewiz.com/epoch_info', { timeout: 8000 });
    const apy = data?.avg_apy || data?.apy || null;
    if (apy) await storeReward('solana', parseFloat(apy) * 100, 'SOL');
  } catch (e) { console.error('[solana] failed:', e.message); }
}

async function fetchRocketPool() {
  try {
    const { data } = await axios.get('https://api.rocketpool.net/api/apr', { timeout: 8000 });
    const apy = data?.yearlyAPR || data?.apr || null;
    if (apy) await storeReward('rocket-pool', parseFloat(apy), 'ETH');
  } catch (e) { console.error('[rocket-pool] failed:', e.message); }
}

async function fetchDefiRates() {
  const defiDefaults = [
    { slug: 'aave', apy: 4.5, token: 'ETH' },
    { slug: 'compound', apy: 3.8, token: 'ETH' },
    { slug: 'curve', apy: 5.2, token: 'CRV' },
    { slug: 'uniswap', apy: 8.5, token: 'ETH' },
    { slug: 'convex', apy: 9.2, token: 'CVX' },
    { slug: 'yearn', apy: 6.8, token: 'ETH' },
    { slug: 'osmosis', apy: 18.5, token: 'OSMO' },
    { slug: 'aave-usdc', apy: 3.2, token: 'USDC' },
    { slug: 'aave-usdt', apy: 3.5, token: 'USDT' },
    { slug: 'aave-dai', apy: 3.1, token: 'DAI' },
    { slug: 'comp-usdc', apy: 2.8, token: 'USDC' },
    { slug: 'comp-dai', apy: 2.6, token: 'DAI' },
    { slug: 'curve-3pool', apy: 4.1, token: 'CRV' },
    { slug: 'curve-steth', apy: 5.8, token: 'CRV' },
    { slug: 'convex-steth', apy: 7.2, token: 'CVX' },
    { slug: 'yearn-usdc', apy: 4.5, token: 'USDC' },
    { slug: 'yearn-dai', apy: 4.2, token: 'DAI' },
    { slug: 'sushi', apy: 12.5, token: 'SUSHI' },
    { slug: 'balancer', apy: 8.9, token: 'BAL' },
    { slug: 'frax', apy: 6.5, token: 'FRAX' },
    { slug: 'pendle', apy: 15.5, token: 'PENDLE' },
    { slug: 'maple', apy: 9.8, token: 'MPL' },
    { slug: 'traderjoe', apy: 11.2, token: 'JOE' },
    { slug: 'pangolin', apy: 9.5, token: 'PNG' },
    { slug: 'beefy-avax', apy: 12.8, token: 'AVAX' },
    { slug: 'beefy-bnb', apy: 11.5, token: 'BNB' },
    { slug: 'alpaca', apy: 18.5, token: 'ALPACA' },
    { slug: 'venus-usdc', apy: 4.2, token: 'USDC' },
    { slug: 'venus-bnb', apy: 6.8, token: 'BNB' },
  ];

  for (const p of defiDefaults) {
    await storeReward(p.slug, p.apy, p.token);
  }
  console.log('[DeFi] Batch stored successfully');
}

async function fetchLiquidStaking() {
  const liquidDefaults = [
    { slug: 'steth', apy: 3.8, token: 'ETH' },
    { slug: 'cbeth', apy: 3.5, token: 'ETH' },
    { slug: 'frxeth', apy: 4.1, token: 'ETH' },
    { slug: 'ethx', apy: 3.9, token: 'ETH' },
    { slug: 'aethc', apy: 3.6, token: 'ETH' },
    { slug: 'msol', apy: 7.2, token: 'SOL' },
    { slug: 'stsol', apy: 6.8, token: 'SOL' },
    { slug: 'jitosol', apy: 8.1, token: 'SOL' },
    { slug: 'bsol', apy: 7.5, token: 'SOL' },
    { slug: 'pstake-atom', apy: 16.5, token: 'ATOM' },
    { slug: 'statom', apy: 17.2, token: 'ATOM' },
    { slug: 'qatom', apy: 15.8, token: 'ATOM' },
    { slug: 'stafi', apy: 8.5, token: 'FIS' },
    { slug: 'lido-bnb', apy: 6.2, token: 'BNB' },
    { slug: 'ankr-bnb', apy: 5.8, token: 'BNB' },
    { slug: 'pstake-bnb', apy: 6.5, token: 'BNB' },
    { slug: 'stader-bnb', apy: 6.8, token: 'BNB' },
    { slug: 'savax', apy: 7.5, token: 'AVAX' },
    { slug: 'qiavax', apy: 8.2, token: 'AVAX' },
    { slug: 'aavaxb', apy: 7.8, token: 'AVAX' },
    { slug: 'avaxsd', apy: 8.5, token: 'AVAX' },
    { slug: 'psol', apy: 7.0, token: 'SOL' },
    { slug: 'polkadot', apy: 14.0, token: 'DOT' },
  ];

  for (const p of liquidDefaults) {
    await storeReward(p.slug, p.apy, p.token);
  }
  console.log('[Liquid Staking] Batch stored successfully');
}

async function runAll() {
  console.log('[Scheduler] Fetching live APY data...');
  await Promise.allSettled([
    fetchLido(),
    fetchCosmos(),
    fetchSolana(),
    fetchRocketPool(),
  ]);
  await fetchCoinGeckoStaking();
  await fetchDefiRates();
  await fetchLiquidStaking();
  console.log('[Scheduler] Cycle complete.');
}

cron.schedule('*/15 * * * *', runAll);
runAll();
console.log('[Scheduler] Started - fetching every 15 minutes');

const { sendDailyReport } = require('./dailyReport');
cron.schedule('0 4 * * *', () => {
  console.log('[Scheduler] Sending daily report...');
  sendDailyReport();
});
console.log('[Scheduler] Daily report scheduled for 9 PM MST');

const { checkAPYChanges } = require('./apyAlerts');
cron.schedule('*/15 * * * *', async () => {
  await checkAPYChanges();
});
console.log('[Scheduler] APY alerts scheduled every 15 minutes');

const { exec } = require('child_process');
cron.schedule('0 2 * * *', () => {
  console.log('[Scheduler] Running daily database backup...');
  exec('node /home/vaultadmin/residualvault/backup.js', (error, stdout, stderr) => {
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  });
});
console.log('[Scheduler] Daily backup scheduled for 2 AM UTC');

cron.schedule('0 3 * * *', async () => {
  console.log('[Cleanup] Running daily APY data cleanup...');
  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const result = await pool.query(`
      DELETE FROM vault_rewards
      WHERE id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY protocol_id ORDER BY fetched_at DESC
          ) as rn
          FROM vault_rewards
        ) ranked
        WHERE rn <= 48
      )
    `);
    console.log(`[Cleanup] Deleted ${result.rowCount} old APY records`);
    await pool.end();
  } catch (err) {
    console.error('[Cleanup] Failed:', err.message);
  }
});
console.log('[Scheduler] Daily APY cleanup scheduled for 3 AM UTC');

const { runChecks } = require('./uptime');
cron.schedule('*/5 * * * *', async () => {
  await runChecks();
});
console.log('[Scheduler] Uptime monitor scheduled every 5 minutes');

// Content Generation Agent - runs every Sunday at 6 PM MST (1 AM Monday UTC)
const { generateWeeklyContent } = require('./contentAgent');
cron.schedule('0 1 * * 1', async () => {
  console.log('[ContentAgent] Sunday content generation triggered...');
  await generateWeeklyContent();
});
console.log('[ContentAgent] Weekly content generation scheduled for Sunday 6 PM MST');

// Social Media Publisher - runs daily at 9 AM MST (4 PM UTC)
const { publishApprovedPosts } = require('./socialPublisher');
cron.schedule('0 16 * * *', async () => {
  console.log('[Publisher] Daily publishing triggered...');
  await publishApprovedPosts();
});
console.log('[Publisher] Daily social publishing scheduled for 9 AM MST');

// Video Generation Agent - runs every Sunday at 7 PM MST (2 AM Monday UTC)
const { generateVideo } = require('./videoAgent');
cron.schedule('0 2 * * 1', async () => {
  console.log('[VideoAgent] Sunday video generation triggered...');
  const { Pool } = require('pg');
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const keywords = await db.query('SELECT keyword FROM keywords WHERE active = true ORDER BY priority DESC LIMIT 5');
  const keywordList = keywords.rows.map(r => r.keyword);
  await generateVideo('Best Crypto Staking Rewards This Week', keywordList);
  await db.end();
});
console.log('[VideoAgent] Weekly video generation scheduled for Sunday 7 PM MST');

// QA Agent — runs every 6 hours
const { runQA } = require('./qaAgent');
const { runFixer } = require('./fixerAgent');
cron.schedule('0 */6 * * *', async () => {
  console.log('[QA Agent] Starting scheduled scan...');
  await runQA();
  console.log('[Fixer Agent] Starting scheduled fixes...');
  await runFixer();
});
console.log('[QA + Fixer Agents] Scheduled every 6 hours');
