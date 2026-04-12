'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const db        = require('../db');

class SeoArchitect extends BaseAgent {
  constructor() {
    super({
      name:      'SEO Architect',
      role:      'You are the SEO Director for ResidualVault. You design and execute comprehensive search engine optimisation strategies including keyword research, content optimisation, technical SEO, link building, and search visibility growth plans that drive sustainable organic traffic.',
      model:     'claude-opus-4-5',
      schedule:  '0 7 * * 0',   // Tuesdays at 6 AM
      timezone:  'America/Denver',
      maxTokens: 6144,
    });
  }

  async conductKeywordResearch(niche) {
    return this.ask(`
Conduct comprehensive keyword research for ResidualVault in the "${niche}" niche.

PLATFORM CONTEXT: ResidualVault — passive income building through digital marketing

Research and categorise 40+ keywords covering:
1. High-intent commercial keywords (ready to buy)
2. Informational keywords (education, awareness)
3. Comparison keywords (vs competitors)
4. Long-tail opportunity keywords
5. Question-based keywords (People Also Ask)

Output JSON:
{
  "niche": "${niche}",
  "keywords": [
    {
      "keyword": "string",
      "type": "commercial|informational|navigational|transactional",
      "estimatedVolume": "string",
      "difficulty": "low|medium|high",
      "intent": "string",
      "priority": 1-10,
      "contentType": "blog|landing-page|video|tool",
      "currentRanking": "not-ranked"
    }
  ],
  "clusterMap": [
    { "pillar": "string", "relatedKeywords": ["string"] }
  ],
  "quickWins": ["string"],
  "longTermTargets": ["string"]
}
`);
  }

  async auditContentSeo(title, content) {
    return this.ask(`
Perform a comprehensive SEO audit on this ResidualVault content:

TITLE: ${title}
CONTENT PREVIEW: ${(content || '').substring(0, 1500)}

Audit:
1. Title tag optimisation
2. Meta description quality
3. Keyword density and placement
4. Header structure (H1-H6)
5. Internal linking opportunities
6. Image alt text recommendations
7. Content depth and comprehensiveness
8. E-E-A-T signals
9. Featured snippet potential
10. Core Web Vitals considerations

Output JSON:
{
  "overallScore": 0-100,
  "grade": "A|B|C|D|F",
  "titleOptimisation": { "score": 0-10, "current": "string", "recommended": "string", "issues": ["string"] },
  "keywordOptimisation": { "score": 0-10, "density": "string", "issues": ["string"], "recommendations": ["string"] },
  "headerStructure": { "score": 0-10, "issues": ["string"], "recommendations": ["string"] },
  "contentDepth": { "score": 0-10, "wordCount": "string", "missingTopics": ["string"] },
  "technicalSeo": { "score": 0-10, "issues": ["string"] },
  "internalLinkOpportunities": ["string"],
  "featuredSnippetPotential": "high|medium|low",
  "priorityFixes": ["string"]
}
`);
  }

  async buildLinkStrategy() {
    return this.ask(`
Create a link building strategy for ResidualVault for the next quarter.

PLATFORM: Passive income / digital marketing SaaS

Include:
1. Link building tactics by priority
2. Target domains and domain authority ranges
3. Content assets for link earning
4. Guest posting strategy
5. Digital PR opportunities
6. Broken link building targets
7. Monthly link targets

Output JSON:
{
  "quarterGoal": { "linksTarget": number, "domainRatingTarget": "string" },
  "tactics": [
    { "tactic": "string", "priority": 1-10, "effort": "low|medium|high", "expectedLinks": number, "timeline": "string" }
  ],
  "contentAssets": [{ "asset": "string", "format": "string", "targetLinks": number, "outreachTargets": ["string"] }],
  "guestPosting": { "targetSites": ["string"], "pitchTopics": ["string"] },
  "digitalPR": { "hooks": ["string"], "mediaTargets": ["string"] },
  "monthlyPlan": [{ "month": "string", "focus": "string", "linksTarget": number }]
}
`);
  }

  async execute(context = {}) {
    this._log('info', 'Running SEO strategy cycle');

    const niches = ['passive income', 'digital marketing', 'online business'];
    const keywordResults = [];

    for (const niche of niches) {
      try {
        const raw     = await this.conductKeywordResearch(niche);
        const result  = this.parseJSON(raw) || {};
        keywordResults.push({ niche, keywords: (result.keywords || []).length, quickWins: result.quickWins });
        await this.saveContent('keyword-research', `Keyword Research: ${niche}`, JSON.stringify(result, null, 2), null, { niche });
      } catch (err) {
        this._log('error', `Keyword research failed for ${niche}: ${err.message}`);
      }
    }

    // Audit recent blog posts
    const recentPosts = db.getGeneratedContent(10).filter(c => c.content_type === 'blog-post');
    let auditResults  = [];

    for (const post of recentPosts.slice(0, 3)) {
      try {
        const raw    = await this.auditContentSeo(post.title, post.content);
        const audit  = this.parseJSON(raw) || {};
        auditResults.push({ postId: post.id, title: post.title, score: audit.overallScore });
        if (audit.overallScore < 60) {
          await this.reportIssue('medium', `Low SEO Score: ${post.title}`, `Score: ${audit.overallScore}/100. Priority fixes: ${(audit.priorityFixes || []).slice(0, 2).join(', ')}`);
        }
      } catch (err) {
        this._log('error', `SEO audit failed: ${err.message}`);
      }
    }

    const linkStrategyRaw = await this.buildLinkStrategy();
    const linkStrategy    = this.parseJSON(linkStrategyRaw) || {};

    await this.saveReport(
      'seo-strategy',
      `SEO Report — ${keywordResults.reduce((s, r) => s + r.keywords, 0)} keywords researched, ${auditResults.length} posts audited`,
      JSON.stringify({ keywordResearch: keywordResults, auditResults, linkStrategy }, null, 2)
    );

    return {
      keywordsResearched: keywordResults.reduce((s, r) => s + r.keywords, 0),
      postsAudited:       auditResults.length,
      avgSeoScore:        auditResults.length ? Math.round(auditResults.reduce((s, r) => s + (r.score || 0), 0) / auditResults.length) : 0,
    };
  }
}

module.exports = SeoArchitect;

if (require.main === module) {
  const agent = new SeoArchitect();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
