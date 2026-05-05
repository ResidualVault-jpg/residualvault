'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseSubAgent = require('./base-sub-agent');

class LinkedInContentCreator extends BaseSubAgent {
  constructor() {
    super({
      name:           'LinkedIn Content Creator',
      departmentHead: 'Social Media Agent',
      role:           'You are a LinkedIn content specialist for ResidualVault. You create thought leadership posts, professional insights, and engaging stories about crypto staking, entrepreneurship, and financial independence.',
      model:          'claude-sonnet-4-6',
      schedule:       '15 7 * * 0',
      timezone:       'America/Denver',
      maxTokens:      4096,
    });
  }

  async execute(context = {}) {
    this._log('info', 'Creating weekly LinkedIn post');
    const themes = ['Professional growth through passive income', 'Crypto staking as a legitimate investment strategy', 'ResidualVault platform insights and data'];
    const theme = themes[Math.floor(Date.now() / 604800000) % themes.length];
    try {
      const raw = await this.ask('Create 1 high-performing LinkedIn post for ResidualVault.' +
        '\nTHEME: ' + theme +
        '\nBRAND VOICE: Professional, authoritative, data-driven yet approachable' +
        '\nAUDIENCE: Finance professionals, crypto investors, entrepreneurs' +
        '\nCADENCE: This is our ONE LinkedIn post for the entire week — make it count' +
        '\nRules: First 150 chars critical, 1300 char sweet spot, max 5 hashtags, include discussion question' +
        '\nOutput JSON array: [{"platform":"LinkedIn","type":"single-post","theme":"' + theme + '","content":"string","hashtags":["string"],"hook":"string","cta":"string","bestPostTime":"Sunday 9 AM MT"}]');
      const posts = this.parseJSON(raw);
      const arr = Array.isArray(posts) ? posts : [];
      await this.saveContent('social-posts', 'LinkedIn Weekly Post - ' + theme, JSON.stringify(arr, null, 2), null, { platform: 'LinkedIn', count: 1, theme, cadence: 'weekly' });
      await this.saveReport('linkedin-content', 'LinkedIn weekly - 1 post', JSON.stringify({ theme, posts: arr.length }, null, 2));
      return { theme, totalPosts: arr.length };
    } catch (err) {
      this._log('error', 'LinkedIn weekly post failed: ' + err.message);
      await this.saveReport('linkedin-content', 'LinkedIn weekly - failed', JSON.stringify({ theme, status: 'failed', error: err.message }, null, 2));
      return { theme, totalPosts: 0 };
    }
  }
}

module.exports = LinkedInContentCreator;

if (require.main === module) {
  const agent = new LinkedInContentCreator();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
