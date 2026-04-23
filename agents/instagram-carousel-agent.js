'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const db        = require('../db');
const fs        = require('fs');
const path      = require('path');
const { renderCarousel } = require('../lib/carousel-renderer');

const OUTPUT_DIR = path.join(__dirname, '../content/carousels');

const CAROUSEL_TOPICS = [
  {
    category: 'Staking Education',
    themes: [
      'What is crypto staking and how does it work',
      'Proof of Stake vs Proof of Work explained simply',
      'The difference between staking, lending, and yield farming',
      'How to evaluate staking risks before committing capital',
      'Validator nodes explained: what they do and why they matter',
      'Liquid staking: earn yields without locking your tokens',
    ],
  },
  {
    category: 'Yield Strategy',
    themes: [
      'Top 5 highest APY staking protocols right now',
      'How to diversify your staking portfolio for maximum safety',
      'The compounding effect: how reinvesting staking rewards grows wealth',
      'Red flags to watch for in high-APY staking offers',
      'Staking vs savings accounts: a real numbers comparison',
      'How to calculate your true staking returns after fees',
    ],
  },
  {
    category: 'Market Insights',
    themes: [
      'How market conditions affect staking yields',
      'The relationship between token price and staking APY',
      'Why institutional money is flowing into staking',
      'Staking dominance: which blockchains have the most staked value',
      'How network upgrades impact staking rewards',
      'The future of staking: trends to watch in 2026',
    ],
  },
  {
    category: 'Platform Features',
    themes: [
      'How ResidualVault tracks 156+ staking protocols in real time',
      'Understanding APY vs APR: what ResidualVault shows you',
      'How to use risk scores to pick safer staking options',
      'Comparing protocols side by side with ResidualVault',
      'Setting up APY alerts so you never miss an opportunity',
      'From free to pro: what each ResidualVault plan unlocks',
    ],
  },
  {
    category: 'Passive Income',
    themes: [
      'Building a passive income stream with crypto staking',
      '5 mistakes beginners make when starting to stake',
      'How much can you earn staking with $100, $1000, or $10000',
      'The set-it-and-forget-it approach to staking income',
      'Tax implications of staking rewards you need to know',
      'Creating a staking ladder strategy for consistent income',
    ],
  },
];

class InstagramCarouselAgent extends BaseAgent {
  constructor() {
    super({
      name:      'Instagram Carousel Agent',
      role:      'You create educational and informational Instagram carousel content about crypto staking, passive income, and the ResidualVault platform. You produce data-driven, visually structured content that educates followers and drives traffic to residualvault.com.',
      model:     'claude-opus-4-6',
      schedule:  '15 8 * * 0',
      timezone:  'America/Denver',
      maxTokens: 8192,
    });
  }

  pickTopics(count = 3) {
    const all = [];
    for (const cat of CAROUSEL_TOPICS) {
      for (const theme of cat.themes) {
        all.push({ category: cat.category, theme });
      }
    }
    const shuffled = all.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  async generateCarouselContent(topic) {
    const raw = await this.ask(`
Create an Instagram carousel (5 slides + cover + CTA) about this topic:
TOPIC: ${topic.theme}
CATEGORY: ${topic.category}

BRAND: ResidualVault — crypto staking comparison and intelligence platform tracking 156+ protocols
AUDIENCE: Crypto investors and passive income seekers, beginner to intermediate
TONE: Educational, confident, data-driven, no hype

Output ONLY valid JSON with this exact structure:
{
  "cover": {
    "category": "${topic.category.toUpperCase()}",
    "title": "short punchy title (max 8 words)",
    "subtitle": "one sentence hook (max 15 words)"
  },
  "slides": [
    {
      "type": "content",
      "number": 1,
      "heading": "short heading (max 6 words)",
      "body": "educational paragraph (40-60 words, clear and specific)",
      "highlight": "one key takeaway sentence (optional, max 12 words)"
    },
    {
      "type": "content",
      "number": 2,
      "heading": "short heading",
      "body": "educational paragraph (40-60 words)",
      "highlight": "key takeaway (optional)"
    },
    {
      "type": "stats",
      "heading": "By The Numbers",
      "stats": [
        { "value": "156+", "label": "Protocols Tracked", "description": "short context" },
        { "value": "32%", "label": "Top APY Available", "description": "short context" },
        { "value": "$XX", "label": "Some Metric", "description": "short context" },
        { "value": "XX%", "label": "Some Metric", "description": "short context" }
      ]
    },
    {
      "type": "content",
      "number": 4,
      "heading": "short heading",
      "body": "educational paragraph (40-60 words)",
      "highlight": "key takeaway (optional)"
    },
    {
      "type": "content",
      "number": 5,
      "heading": "short heading",
      "body": "educational paragraph with actionable advice (40-60 words)",
      "highlight": "key takeaway"
    }
  ],
  "cta": {
    "cta": "compelling call to action (max 10 words)",
    "buttonText": "Visit ResidualVault.com",
    "followText": "Follow @residualvault for daily insights"
  },
  "caption": "Instagram caption (150-200 words) with hook in first line, value-packed body, and 20-25 relevant hashtags at the end",
  "altText": "accessibility description of what the carousel teaches"
}

Rules:
- Use REAL data and accurate crypto/staking information
- Stats slide should use factual, verifiable numbers
- Each content slide should teach ONE clear concept
- Build knowledge progressively across slides
- End with actionable advice the reader can use today
- Caption must start with a strong hook before the "more" fold
`);
    return this.parseJSON(raw);
  }

  async execute() {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const topics = this.pickTopics(3);
    this._log('info', `Generating ${topics.length} carousels: ${topics.map(t => t.theme).join(' | ')}`);
    const results = [];

    for (const topic of topics) {
      try {
        this._log('info', `Generating content: ${topic.theme}`);
        const content = await this.generateCarouselContent(topic);
        if (!content || !content.slides) {
          this._log('error', `Bad content structure for: ${topic.theme}`);
          results.push({ theme: topic.theme, status: 'failed', reason: 'bad_structure' });
          continue;
        }

        this._log('info', `Rendering slides: ${topic.theme}`);
        const buffers = renderCarousel(content);

        const slug = topic.theme
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '')
          .slice(0, 60);
        const ts = new Date().toISOString().split('T')[0];
        const dir = path.join(OUTPUT_DIR, `${ts}_${slug}`);
        fs.mkdirSync(dir, { recursive: true });

        const imagePaths = [];
        for (let i = 0; i < buffers.length; i++) {
          const fp = path.join(dir, `slide_${String(i + 1).padStart(2, '0')}.png`);
          fs.writeFileSync(fp, buffers[i]);
          imagePaths.push(fp);
        }

        await this.saveContent(
          'instagram-carousel',
          `IG Carousel: ${content.cover.title}`,
          JSON.stringify({
            topic: topic.theme,
            category: topic.category,
            caption: content.caption,
            altText: content.altText,
            slideCount: buffers.length,
            imagePaths,
            imageDir: dir,
          }, null, 2),
          null,
          {
            platform: 'instagram',
            type: 'carousel',
            slideCount: buffers.length,
            category: topic.category,
            imageDir: dir,
          }
        );

        const totalSize = buffers.reduce((s, b) => s + b.length, 0);
        this._log('info', `Saved ${buffers.length} slides (${(totalSize / 1024).toFixed(0)} KB) → ${dir}`);
        results.push({ theme: topic.theme, slides: buffers.length, dir, status: 'success' });

      } catch (err) {
        this._log('error', `Failed: ${topic.theme} — ${err.message}`);
        results.push({ theme: topic.theme, status: 'failed', reason: err.message });
      }
    }

    const success = results.filter(r => r.status === 'success').length;
    const totalSlides = results.reduce((s, r) => s + (r.slides || 0), 0);

    await this.saveReport(
      'carousel-generation',
      `Generated ${success}/${topics.length} carousels (${totalSlides} total slides)`,
      JSON.stringify(results, null, 2),
      success < topics.length ? 'high' : 'normal'
    );

    return { carousels: success, totalSlides, results };
  }
}

module.exports = InstagramCarouselAgent;

if (require.main === module) {
  const agent = new InstagramCarouselAgent();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
