require('dotenv').config();
const pool = require('./db');

async function generateSitemap() {
  const base = 'https://www.residualvault.com';
  const today = new Date().toISOString().split('T')[0];

  const staticPages = [
    { url: '/', priority: '1.0', changefreq: 'daily' },
    { url: '/staking', priority: '0.9', changefreq: 'daily' },
    { url: '/calculator', priority: '0.9', changefreq: 'weekly' },
    { url: '/blog', priority: '0.8', changefreq: 'weekly' },
    { url: '/pricing', priority: '0.8', changefreq: 'monthly' },
    { url: '/education', priority: '0.7', changefreq: 'weekly' },
    { url: '/register', priority: '0.7', changefreq: 'monthly' },
    { url: '/login', priority: '0.5', changefreq: 'monthly' },
    { url: '/privacy', priority: '0.3', changefreq: 'monthly' },
    { url: '/terms', priority: '0.3', changefreq: 'monthly' },
    { url: '/contact', priority: '0.5', changefreq: 'monthly' },
  ];

  const blogPosts = [
    { slug: 'best-crypto-staking-rewards-2026', date: '2026-03-15' },
    { slug: 'atom-staking-guide', date: '2026-03-03' },
    { slug: 'tangem-wallet-guide', date: '2026-03-04' },
    { slug: 'ethereum-staking-guide-2026', date: '2026-03-20' },
    { slug: 'liquid-staking-guide-2026', date: '2026-03-22' },
    { slug: 'crypto-staking-tax-guide-2026', date: '2026-03-25' },
  ];

  const protocols = await pool.query('SELECT slug FROM protocols ORDER BY name');

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

  // Static pages
  for (const page of staticPages) {
    xml += `
  <url>
    <loc>${base}${page.url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`;
  }

  // Blog posts
  for (const post of blogPosts) {
    xml += `
  <url>
    <loc>${base}/blog/${post.slug}</loc>
    <lastmod>${post.date}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`;
  }

  // Protocol pages
  for (const p of protocols.rows) {
    xml += `
  <url>
    <loc>${base}/protocol/${p.slug}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>`;
  }

  xml += '\n</urlset>';
  return xml;
}

module.exports = { generateSitemap };
