'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseSubAgent = require('./base-sub-agent');

class TwitterContentCreator extends BaseSubAgent {
  constructor() {
    super({
      name:           'Twitter Content Creator',
      departmentHead: 'Social Media Agent',
      role:           'You are a Twitter/X content specialist for ResidualVault. You create viral, engagement-optimized tweets and threads about crypto staking, passive income, and financial freedom.',
      model:          'claude-sonnet-4-6',
      schedule:       '0 7 * * 0',
      timezone:       'America/Denver',
      maxTokens:      4096,
    });
  }

  async execute(context = {}) {
    var feedbackContext = await this.buildFeedbackContext();
    if (feedbackContext) this._log('info', 'Incorporating department head feedback');
    this._log('info', 'Creating Twitter/X content batch');
    const themes = ['Crypto staking tips and APY comparisons', 'Passive income mindset and motivation', 'ResidualVault platform features and benefits'];
    const results = [];
    for (const theme of themes) {
      try {
        const raw = await this.ask('Create 3 high-performing Twitter/X posts for ResidualVault.' + feedbackContext + +
          '\nTHEME: ' + theme +
          '\nBRAND VOICE: Confident, empowering, educational' +
          '\nAUDIENCE: Crypto investors and passive income seekers' +
          '\nRules: Max 280 chars per tweet, strong hook, clear CTA, max 3 hashtags' +
          '\nOutput JSON array: [{"platform":"Twitter/X","type":"single-post","theme":"' + theme + '","content":"string","hashtags":["string"],"hook":"string","cta":"string","bestPostTime":"string"}]');
        const posts = this.parseJSON(raw);
        const arr = Array.isArray(posts) ? posts : [];
        await this.saveContent('social-posts', 'Twitter/X Posts - ' + theme, JSON.stringify(arr, null, 2), null, { platform: 'Twitter/X', count: arr.length, theme });
        results.push({ theme, posts: arr.length });
      } catch (err) {
        this._log('error', 'Twitter content failed for ' + theme + ': ' + err.message);
        results.push({ theme, status: 'failed' });
      }
    }
    const total = results.reduce((s, r) => s + (r.posts || 0), 0);
    await this.saveReport('twitter-content', 'Twitter batch - ' + total + ' posts', JSON.stringify(results, null, 2));
    return { themes: results.length, totalPosts: total };
  }
}

module.exports = TwitterContentCreator;

if (require.main === module) {
  const agent = new TwitterContentCreator();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
