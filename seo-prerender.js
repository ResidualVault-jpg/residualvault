const pool = require('./db');
const fs = require('fs');
const path = require('path');

const FRONTEND_DIR = '/home/vaultadmin/rv-original/residualvault-platform-final/frontend/dist';
let cachedHtml = null;

function getBaseHtml() {
  if (!cachedHtml) cachedHtml = fs.readFileSync(path.join(FRONTEND_DIR, 'index.html'), 'utf-8');
  return cachedHtml;
}

const BOT_UA = /googlebot|bingbot|yandexbot|baiduspider|duckduckbot|slurp|facebookexternalhit|linkedinbot|twitterbot|applebot|semrushbot|ahrefsbot|mj12bot|dotbot|petalbot|bytespider|google-inspectiontool/i;

function isBot(req) {
  return BOT_UA.test(req.headers['user-agent'] || '');
}

function buildPage(meta, bodyContent, stripScripts) {
  let html = getBaseHtml();

  const newTags = `<title>${meta.title}</title>
    <meta name="description" content="${meta.description}" />
    <meta property="og:title" content="${meta.title}" />
    <meta property="og:description" content="${meta.description}" />
    <meta property="og:url" content="${meta.url}" />
    <meta property="og:type" content="article" />
    <meta property="og:image" content="https://residualvault.com/rv-logo-1024.png" />
    <meta property="og:site_name" content="ResidualVault" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:site" content="@ResidualVault" />
    <meta name="twitter:title" content="${meta.title}" />
    <meta name="twitter:description" content="${meta.description}" />
    <meta name="twitter:image" content="https://residualvault.com/rv-logo-1024.png" />${meta.canonical ? `\n    <link rel="canonical" href="${meta.canonical}" />` : ''}`;

  html = html.replace(/<title>[^<]*<\/title>/g, '');
  html = html.replace(/<meta name="description"[^>]*\/>/g, '');
  html = html.replace(/<meta property="og:[^"]*"[^>]*\/>/g, '');
  html = html.replace(/<meta name="twitter:[^"]*"[^>]*\/>/g, '');
  html = html.replace(/<!-- Open Graph -->/g, '');
  html = html.replace('<meta name="keywords"', newTags + '\n    <meta name="keywords"');
  html = html.replace('<div id="root"></div>', `<div id="root">${bodyContent}</div>`);

  if (stripScripts) {
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<link[^>]*rel="modulepreload"[^>]*>/gi, '');
  }

  return html;
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

const BLOG_META = {
  'ethereum-staking-guide-2026': { title: 'How to Stake Ethereum (ETH) in 2026 — Complete Guide | ResidualVault', description: 'Learn how to stake Ethereum in 2026. Step-by-step guide covering Lido, Rocket Pool, Coinbase, and native staking with current APY rates and risk analysis.', body: '<h1>How to Stake Ethereum (ETH) in 2026 — Complete Guide</h1><p>Ethereum staking lets you earn passive income by locking ETH to help secure the network. In 2026, you can stake ETH through native staking (32 ETH minimum), liquid staking protocols like Lido (stETH) and Rocket Pool (rETH), or centralized exchanges like Coinbase and Kraken.</p><p>Current Ethereum staking APY ranges from 3-5% depending on the method. Liquid staking offers flexibility — you receive a token representing your staked ETH that can be used in DeFi while still earning rewards.</p><h2>Staking Methods Compared</h2><ul><li><strong>Native Staking:</strong> 32 ETH minimum, ~3.8% APY, full control</li><li><strong>Lido (stETH):</strong> No minimum, ~3.5% APY, liquid staking token</li><li><strong>Rocket Pool (rETH):</strong> 0.01 ETH minimum, ~3.3% APY, decentralized</li><li><strong>Coinbase:</strong> No minimum, ~3.0% APY, custodial</li></ul><p><a href="/staking">Compare all 156+ staking protocols on ResidualVault</a></p>' },
  'liquid-staking-guide-2026': { title: 'Liquid Staking vs Native Staking — Complete Comparison 2026 | ResidualVault', description: 'Compare liquid staking vs native staking. Understand LSTs like stETH and rETH, their risks, and when to use each approach for maximum returns.', body: '<h1>Liquid Staking vs Native Staking — Complete Comparison 2026</h1><p>Native staking locks your tokens directly on the blockchain, while liquid staking gives you a tradeable token (LST) representing your staked position. Both earn staking rewards, but they differ in flexibility, risk, and returns.</p><h2>Key Differences</h2><ul><li><strong>Liquidity:</strong> Native staking locks tokens; liquid staking keeps them usable in DeFi</li><li><strong>Minimum:</strong> Native often requires large minimums (32 ETH); liquid staking has no minimum</li><li><strong>Risk:</strong> Native has validator risk; liquid adds smart contract and depeg risk</li><li><strong>Returns:</strong> Similar APY, but LSTs can earn additional yield in DeFi</li></ul><p><a href="/staking">Compare all staking options on ResidualVault</a></p>' },
  'crypto-staking-tax-guide-2026': { title: 'Crypto Staking Taxes — Complete Guide for 2026 | ResidualVault', description: 'How are crypto staking rewards taxed in 2026? Complete guide to reporting staking income, capital gains, and tax optimization strategies.', body: '<h1>Crypto Staking Taxes — Complete Guide for 2026</h1><p>In the United States, crypto staking rewards are taxed as ordinary income at the fair market value when received. When you later sell or trade those rewards, any gain or loss is treated as a capital gain.</p><h2>Key Tax Rules for Staking</h2><ul><li>Staking rewards are taxable income when received</li><li>Cost basis equals the fair market value at time of receipt</li><li>Selling staking rewards triggers capital gains tax</li><li>Record keeping is essential — track every reward received</li></ul><p><a href="/staking">Track your staking positions on ResidualVault</a></p>' },
  'best-crypto-staking-rewards-2026': { title: 'Best Crypto Staking Rewards 2026: Highest APY Protocols | ResidualVault', description: 'Compare the best crypto staking rewards in 2026. Rankings of highest APY protocols for ETH, SOL, ATOM, DOT and 156+ more with live rates.', body: '<h1>Best Crypto Staking Rewards 2026: Highest APY Protocols</h1><p>Looking for the highest staking yields in 2026? We track APY rates across 156+ protocols in real time. Top yields include Persistence (XPRT) at 32% APY, Stargaze (STARS) at 25%, and Cosmos Hub (ATOM) at 18.5%.</p><h2>Top Staking Protocols by APY</h2><ul><li><strong>Persistence (XPRT):</strong> 32% APY — Native staking</li><li><strong>Stargaze (STARS):</strong> 25% APY — Native staking</li><li><strong>Cosmos Hub (ATOM):</strong> 18.5% APY — Native staking</li><li><strong>Ethereum (ETH):</strong> 3.8% APY — Proof of stake</li><li><strong>Solana (SOL):</strong> 3.9% APY — Native staking</li></ul><p><a href="/leaderboard">See the full live leaderboard on ResidualVault</a></p>' },
  'atom-staking-guide': { title: 'Cosmos ATOM Staking Rewards: Complete Guide 2026 | ResidualVault', description: 'Complete guide to staking Cosmos ATOM. Learn about validators, delegation, rewards, and how to maximize your ATOM staking returns.', body: '<h1>Cosmos ATOM Staking Rewards: Complete Guide 2026</h1><p>Cosmos Hub (ATOM) offers approximately 18.5% APY through native staking. You delegate your ATOM to a validator who secures the network, and earn rewards proportional to your stake.</p><h2>How to Stake ATOM</h2><ul><li>Choose a validator with good uptime and reasonable commission</li><li>Delegate ATOM through Keplr wallet or a compatible wallet</li><li>Rewards accrue automatically — claim and restake to compound</li><li>21-day unbonding period when you unstake</li></ul><p><a href="/protocol/cosmos">See live ATOM staking rates on ResidualVault</a></p>' },
  'tangem-wallet-guide': { title: 'Tangem Wallet Staking Guide: Secure Staking 2026 | ResidualVault', description: 'How to stake crypto with Tangem hardware wallet. Step-by-step guide to earning staking rewards while keeping your assets secure.', body: '<h1>Tangem Wallet Staking Guide: Secure Your Crypto While Earning</h1><p>Tangem is a card-shaped hardware wallet that supports staking for multiple cryptocurrencies. It combines the security of cold storage with the ability to earn staking rewards.</p><h2>Supported Staking Assets</h2><ul><li>Ethereum (ETH) — via liquid staking</li><li>Solana (SOL) — native delegation</li><li>Cosmos (ATOM) — validator delegation</li><li>Polkadot (DOT) — nomination staking</li></ul><p><a href="/staking">Compare all staking options on ResidualVault</a></p>' },
};

const STATIC_META = {
  '/staking': { title: 'Compare 156+ Crypto Staking Protocols — Live APY Rates | ResidualVault', description: 'Compare live staking APY rates across 156+ crypto protocols. Side-by-side comparison for Ethereum, Cosmos ATOM, Solana, Cardano, Polkadot and more. Updated in real time.' },
  '/calculator': { title: 'Crypto Staking Calculator — Compare Returns Over 1-10 Years | ResidualVault', description: 'Calculate crypto staking returns with compound interest. Compare earnings across multiple protocols over 1-10 years with live APY rates.' },
  '/leaderboard': { title: 'Highest Yielding Staking Protocols — Live Leaderboard | ResidualVault', description: 'Live ranking of the highest yielding crypto staking protocols. See top APY rates, biggest movers, and compare staking rewards across 156+ protocols.' },
  '/pricing': { title: 'Pricing — Free, Starter, Pro & Premium Plans | ResidualVault', description: 'ResidualVault is free to start. Compare up to 10 protocols free. Upgrade for unlimited comparisons, advanced analytics, tax reporting, and API access.' },
  '/about': { title: 'About ResidualVault — Crypto Staking Intelligence Platform', description: 'ResidualVault aggregates 156+ DeFi staking protocols with live APY data, risk ratings, and comparison tools. Built by Mochtar Abukusumo in Albuquerque, NM.' },
  '/education': { title: 'Crypto Staking Education — Free DeFi Courses | ResidualVault', description: 'Learn crypto staking from beginner to advanced. Free courses on DeFi basics, APY vs APR, liquid staking, Cosmos ATOM, yield strategies, and portfolio building.' },
  '/blog': { title: 'Crypto Staking Blog — Guides, Analysis & Market Insights | ResidualVault', description: 'Expert guides on crypto staking, DeFi yield strategies, tax reporting, and protocol analysis. Updated weekly with the latest staking insights.' },
  '/': { title: 'ResidualVault — Compare 156+ Crypto Staking Protocols | Live APY Rates', description: 'Compare live APY rates across 156+ crypto staking protocols. Side-by-side comparison for Ethereum, Solana, Cosmos, Polkadot, Cardano and more. Free staking calculator and risk analysis.' },
};

const STATIC_BODY = {
  '/staking': null,
  '/calculator': '<h1>Crypto Staking Calculator</h1><p>Calculate your potential staking returns with compound interest. Enter your investment amount, select a protocol, and see projected earnings over 1 to 10 years.</p><p>ResidualVault tracks live APY rates across 156+ staking protocols including Ethereum, Solana, Cosmos ATOM, Polkadot, Cardano, and more. Use this calculator to compare returns side by side and find the best yield for your risk tolerance.</p><h2>How Staking Returns Work</h2><p>Staking rewards compound over time. A protocol offering 10% APY on a $10,000 investment yields approximately $10,500 after 6 months and $11,047 after 1 year with monthly compounding.</p><p><a href="/staking">Browse all 156+ protocols</a> | <a href="/leaderboard">See the APY leaderboard</a></p>',
  '/leaderboard': null,
  '/pricing': '<h1>ResidualVault Pricing</h1><p>Compare crypto staking protocols for free. Upgrade for advanced analytics, unlimited comparisons, and professional tools.</p><h2>Plans</h2><ul><li><strong>Free ($0):</strong> Access all 156+ protocols, compare up to 10, basic portfolio tracking, educational content</li><li><strong>Starter ($3.69/mo):</strong> Unlimited comparisons, advanced analytics, price alerts, ad-free</li><li><strong>Pro ($9.99/mo):</strong> Advanced risk analytics, tax reporting tools, custom alerts, priority support</li><li><strong>Premium ($19.99/mo):</strong> API access, custom integrations, advanced reporting, dedicated account manager</li></ul><p>All paid plans include a 7-day free trial. No credit card required to start. 30-day money-back guarantee.</p>',
  '/about': '<h1>About ResidualVault</h1><p>ResidualVault is a crypto staking intelligence platform that aggregates live APY data, risk ratings, and comparison tools for 156+ DeFi staking protocols.</p><p>Founded by Mochtar Abukusumo, a digital asset investor and AI systems builder based in Albuquerque, New Mexico. What started as a personal tool for tracking staking rates became a full platform after realizing every crypto investor faces the same problem: too many protocols, too little transparency.</p><p>Residual Vault, LLC is a registered company. The entire platform — including a 31-agent AI content system and live data pipeline — is built in-house with no third-party automation platforms.</p><h2>Our Mission</h2><p>Give every crypto investor the data and tools to maximize staking returns while understanding the real risks involved. Transparency first — real data, real risks, honest comparisons.</p>',
  '/education': '<h1>Crypto Staking Education Hub</h1><p>Learn crypto staking from beginner to advanced with free courses on ResidualVault.</p><h2>Available Courses</h2><ul><li><strong>Crypto Staking 101</strong> (Beginner, 15 min) — Learn the fundamentals of crypto staking and how it generates passive income</li><li><strong>Understanding APY vs APR</strong> (Beginner, 10 min) — Why the difference matters for your staking returns</li><li><strong>Liquid Staking Deep Dive</strong> (Intermediate, 20 min) — Explore protocols like Lido and Rocket Pool</li><li><strong>ATOM &amp; Cosmos Staking Guide</strong> (Intermediate, 18 min) — Complete guide to staking on Cosmos Hub</li><li><strong>DeFi Yield Strategies</strong> (Advanced, 25 min) — Advanced yield farming and risk management</li><li><strong>Building a Staking Portfolio</strong> (Advanced, 30 min) — Diversification, risk, and return optimization</li></ul>',
  '/blog': '<h1>ResidualVault Blog — Crypto Staking Guides & Analysis</h1><p>Expert guides and analysis on crypto staking, DeFi yield strategies, and passive income with cryptocurrency.</p><h2>Latest Articles</h2><ul><li><a href="/blog/ethereum-staking-guide-2026">How to Stake Ethereum (ETH) in 2026 — Complete Guide</a></li><li><a href="/blog/liquid-staking-guide-2026">Liquid Staking vs Native Staking — Complete Comparison 2026</a></li><li><a href="/blog/crypto-staking-tax-guide-2026">Crypto Staking Taxes — Complete Guide for 2026</a></li><li><a href="/blog/best-crypto-staking-rewards-2026">Best Crypto Staking Rewards 2026: Which Crypto Pays the Highest APY?</a></li><li><a href="/blog/atom-staking-guide">Cosmos ATOM Staking Rewards: Complete Guide 2026</a></li><li><a href="/blog/tangem-wallet-guide">Tangem Wallet Staking Guide: Secure Your Crypto While Earning</a></li></ul>',
  '/': '<h1>ResidualVault — Compare Crypto Staking Protocols</h1><p>Compare live APY rates across 156+ crypto staking protocols. Find the best staking yields for Ethereum, Solana, Cosmos ATOM, Polkadot, Cardano, and more.</p><h2>Why ResidualVault?</h2><ul><li><strong>156+ Protocols:</strong> The most comprehensive staking comparison platform</li><li><strong>Live APY Rates:</strong> Real-time yield data updated continuously</li><li><strong>Risk Analysis:</strong> Understand the risks before you stake</li><li><strong>Free Calculator:</strong> Calculate compound staking returns over 1-10 years</li></ul><h2>Top Staking Protocols</h2><p>Browse our <a href="/staking">full protocol comparison</a>, check the <a href="/leaderboard">APY leaderboard</a>, or use the <a href="/calculator">staking calculator</a> to estimate your returns.</p><h2>Free Educational Resources</h2><p>New to staking? Start with our <a href="/education">free courses</a> covering everything from staking basics to advanced DeFi yield strategies.</p>',
};

async function seoPrerender(req, res, next) {
  const urlPath = req.path.replace(/\/$/, '') || '/';
  if (urlPath.startsWith('/api') || urlPath.startsWith('/rv-control') || urlPath.startsWith('/agent-control')) return next();
  const ext = path.extname(urlPath);
  if (ext && ext !== '.html') return next();

  let meta = null;
  let body = '';

  if (urlPath.startsWith('/blog/')) {
    const slug = urlPath.replace('/blog/', '');
    if (BLOG_META[slug]) {
      meta = { ...BLOG_META[slug], url: 'https://www.residualvault.com/blog/' + slug, canonical: 'https://www.residualvault.com/blog/' + slug };
      body = BLOG_META[slug].body || '';
    }
  } else if (urlPath.match(/^\/staking\/(ethereum|solana|cosmos|polkadot|cardano|avalanche|polygon|bnb|near|fantom|tezos|algorand|bitcoin)$/)) {
    const coin = urlPath.replace('/staking/', '');
    const coinName = coin.charAt(0).toUpperCase() + coin.slice(1);
    try {
      const result = await pool.query(`
        SELECT p.name, p.slug, p.chain, p.category, COALESCE(vr.apy, 0) as apy
        FROM protocols p
        LEFT JOIN LATERAL (SELECT apy FROM vault_rewards WHERE protocol_id = p.id ORDER BY fetched_at DESC LIMIT 1) vr ON true
        WHERE LOWER(p.chain) LIKE $1 AND COALESCE(vr.apy, 0) > 0
        ORDER BY vr.apy DESC LIMIT 15`, ['%' + coin + '%']);
      
      if (result.rows.length) {
        const topApy = parseFloat(result.rows[0].apy).toFixed(2);
        meta = {
          title: `${coinName} Staking — Best APY Rates 2026 | ResidualVault`,
          description: `Compare ${coinName} staking rates across ${result.rows.length} protocols. Top APY: ${topApy}%. Live rates, risk ratings, and staking calculator.`,
          url: `https://www.residualvault.com/staking/${coin}`,
          canonical: `https://www.residualvault.com/staking/${coin}`,
        };
        const rows = result.rows.map(r => `<li><a href="/protocol/${esc(r.slug)}">${esc(r.name)} — ${parseFloat(r.apy).toFixed(2)}% APY</a> [${esc(r.category)}]</li>`).join('');
        body = `<h1>${coinName} Staking — Best APY Rates 2026</h1>` +
          `<p>Compare the best ${coinName} staking rates across ${result.rows.length} protocols tracked by ResidualVault. Find the highest yields, understand the risks, and start earning passive income with ${coinName} staking.</p>` +
          `<h2>Top ${coinName} Staking Protocols by APY</h2><ul>${rows}</ul>` +
          `<h2>How ${coinName} Staking Works</h2>` +
          `<p>${coinName} staking lets you earn passive income by locking your tokens to help secure the network. Rewards vary by protocol, validator, and staking method. Use our calculator to estimate your potential returns.</p>` +
          `<p><a href="/calculator">Calculate ${coinName} staking returns</a> | <a href="/staking">Compare all 156+ protocols</a></p>`;
      }
    } catch (err) { console.error('[SEO Coin]', err.message); }
  } else if (urlPath.startsWith('/protocol/')) {
    const slug = urlPath.replace('/protocol/', '');
    try {
      const result = await pool.query(`
        SELECT p.name, p.chain, p.category, p.slug, COALESCE(vr.apy, 0) as apy
        FROM protocols p
        LEFT JOIN LATERAL (SELECT apy FROM vault_rewards WHERE protocol_id = p.id ORDER BY fetched_at DESC LIMIT 1) vr ON true
        WHERE p.slug = $1`, [slug]);
      if (result.rows.length) {
        const p = result.rows[0];
        const apy = parseFloat(p.apy).toFixed(2);
        meta = {
          title: p.name + ' Staking — ' + apy + '% APY | ResidualVault',
          description: 'Stake ' + p.chain + ' with ' + p.name + ' and earn ' + apy + '% APY. Compare with 156+ other protocols. Live rates, risk ratings, and staking calculator.',
          url: 'https://www.residualvault.com/protocol/' + slug,
          canonical: 'https://www.residualvault.com/protocol/' + slug,
        };
        const related = await pool.query(`
          SELECT p.name, p.slug, COALESCE(vr.apy, 0) as apy
          FROM protocols p
          LEFT JOIN LATERAL (SELECT apy FROM vault_rewards WHERE protocol_id = p.id ORDER BY fetched_at DESC LIMIT 1) vr ON true
          WHERE p.category = $1 AND p.slug != $2 AND COALESCE(vr.apy, 0) > 0
          ORDER BY vr.apy DESC LIMIT 5`, [p.category, slug]);
        const relatedHtml = related.rows.map(r => `<li><a href="/protocol/${esc(r.slug)}">${esc(r.name)} — ${parseFloat(r.apy).toFixed(2)}% APY</a></li>`).join('');
        body = `<h1>${esc(p.name)} Staking — ${apy}% APY</h1>` +
          `<p>Stake ${esc(p.chain)} with ${esc(p.name)} and earn ${apy}% APY. ${esc(p.name)} is a ${esc(p.category)} protocol on the ${esc(p.chain)} chain.</p>` +
          `<h2>Current Staking Stats</h2><ul><li>Current APY: ${apy}%</li><li>Chain: ${esc(p.chain)}</li><li>Category: ${esc(p.category)}</li></ul>` +
          `<h2>Staking Calculator</h2><p>Calculate your potential earnings staking with ${esc(p.name)}. Enter an amount to see daily, monthly, and yearly returns at the current ${apy}% APY rate.</p>` +
          (relatedHtml ? `<h2>Related Protocols</h2><ul>${relatedHtml}</ul>` : '') +
          `<p><a href="/staking">Compare all 156+ staking protocols on ResidualVault</a></p>`;
      }
    } catch (err) { console.error('[SEO]', err.message); }
  } else if (urlPath === '/staking') {
    meta = STATIC_META['/staking'];
    meta = { ...meta, url: 'https://www.residualvault.com/staking', canonical: 'https://www.residualvault.com/staking' };
    try {
      const result = await pool.query(`
        SELECT p.name, p.slug, p.chain, p.category, COALESCE(vr.apy, 0) as apy
        FROM protocols p
        LEFT JOIN LATERAL (SELECT apy FROM vault_rewards WHERE protocol_id = p.id ORDER BY fetched_at DESC LIMIT 1) vr ON true
        WHERE COALESCE(vr.apy, 0) > 0
        ORDER BY vr.apy DESC LIMIT 30`);
      const rows = result.rows.map(r => `<li><a href="/protocol/${esc(r.slug)}">${esc(r.name)} (${esc(r.chain)}) — ${parseFloat(r.apy).toFixed(2)}% APY</a> [${esc(r.category)}]</li>`).join('');
      const categories = [...new Set(result.rows.map(r => r.category))];
      body = `<h1>Compare 156+ Crypto Staking Protocols — Live APY Rates</h1>` +
        `<p>Compare live staking APY rates across 156+ crypto protocols. Side-by-side comparison for Ethereum, Cosmos ATOM, Solana, Cardano, Polkadot and more. Updated in real time.</p>` +
        `<h2>Categories</h2><p>${categories.map(c => esc(c)).join(', ')}</p>` +
        `<h2>Top Staking Protocols by APY</h2><ul>${rows}</ul>` +
        `<p><a href="/calculator">Calculate staking returns</a> | <a href="/leaderboard">View full leaderboard</a></p>`;
    } catch (err) {
      body = '<h1>Compare 156+ Crypto Staking Protocols</h1><p>Browse and compare live APY rates across all major DeFi staking protocols.</p>';
    }
  } else if (urlPath === '/leaderboard') {
    meta = { ...STATIC_META['/leaderboard'], url: 'https://www.residualvault.com/leaderboard', canonical: 'https://www.residualvault.com/leaderboard' };
    try {
      const result = await pool.query(`
        SELECT p.name, p.slug, COALESCE(vr.apy, 0) as apy
        FROM protocols p
        LEFT JOIN LATERAL (SELECT apy FROM vault_rewards WHERE protocol_id = p.id ORDER BY fetched_at DESC LIMIT 1) vr ON true
        WHERE COALESCE(vr.apy, 0) > 0
        ORDER BY vr.apy DESC LIMIT 20`);
      const rows = result.rows.map((r, i) => `<li>#${i+1} <a href="/protocol/${esc(r.slug)}">${esc(r.name)}</a> — ${parseFloat(r.apy).toFixed(2)}% APY</li>`).join('');
      body = `<h1>Staking Leaderboard — Highest Yielding Protocols</h1>` +
        `<p>Live ranking of the highest yielding crypto staking protocols. Updated every 15 minutes.</p>` +
        `<h2>Top 20 Protocols by APY</h2><ol>${rows}</ol>` +
        `<p><a href="/staking">Browse all 156+ protocols</a> | <a href="/calculator">Calculate returns</a></p>`;
    } catch (err) { body = '<h1>Staking Leaderboard</h1><p>Live ranking of the highest yielding staking protocols.</p>'; }
  } else if (STATIC_META[urlPath]) {
    meta = { ...STATIC_META[urlPath], url: 'https://www.residualvault.com' + urlPath, canonical: 'https://www.residualvault.com' + urlPath };
    body = STATIC_BODY[urlPath] || '';
  }

  if (meta) {
    const bot = isBot(req);
    try { return res.send(buildPage(meta, body, bot)); }
    catch (err) { console.error('[SEO]', err.message); }
  }
  next();
}

module.exports = { seoPrerender };
