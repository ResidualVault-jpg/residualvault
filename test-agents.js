'use strict';
/**
 * ResidualVault Agent Test Harness
 * Mocks Claude API responses so all agent logic, DB writes,
 * error handling and report saving are exercised without real API keys.
 */

require('dotenv').config();
const BaseAgent = require('./agents/base-agent');

// ─── Generic mock responses per agent ────────────────────────────────────────
const MOCK_RESPONSES = {
  default: JSON.stringify({
    status: 'ok', summary: 'Mock response for testing', score: 85,
    findings: [], recommendations: ['Test rec 1'], threatLevel: 'low',
    overallSentiment: 'positive', sentimentScore: 80, segments: [],
    opportunities: [], trends: [], competitors: [], emails: [],
    weekOf: new Date().toISOString().split('T')[0],
    businessHealth: { status: 'good', score: 82, trend: 'improving' },
    mrrHealth: { status: 'growing', trend: 'Upward', concern: null },
    anomaliesDetected: false, anomalies: [], alertLevel: 'green',
    systemHealth: { status: 'green', score: 90, notes: 'All systems nominal' },
    contentCalendar: [], totalSlots: 14, gaps: [], contentNeeds: [],
    healthSegments: [], criticalGaps: [], overallHealth: 'green',
    threatLevel2: 'green', activeCrises: [], escalationRequired: false,
    okrs: [], strategicOpps: [], threats: [], ceoActionItems: [],
    executiveSummary: 'Mock executive summary for test run.',
    journeys: [], touchpoints: [], days: [], weeks: [],
    partners: [], topPick: 'Test Partner', outreachCalendar: 'Weekly',
    prompts: [], discussionStarters: [], templates: [],
    adCopies: [{ variation:'A', headline1:'Test', description:'Desc', cta:'Click' }],
    budgetAllocation: {}, narrativeArcs: [], funnelStages: [],
    keywords: [{ keyword:'passive income', type:'commercial', priority:9 }],
    clusterMap: [], quickWins: ['Win 1'], longTermTargets: ['Target 1'],
    title: 'Mock Blog Post Title', content: '<p>Mock content</p>',
    metaDescription: 'Mock meta description', slug: 'mock-post',
    subject: 'Mock Newsletter Subject', previewText: 'Preview here',
    sequenceName: 'Mock Sequence', campaignName: 'Mock Campaign',
    promoCode: 'TEST10', name: 'Mock Promo', offer: { promoCode: 'TEST10' },
    tiers: [], programName: 'Mock Loyalty Program', concept: 'Test concept',
    checklistDate: new Date().toISOString().split('T')[0],
    overallStatus: 'green', items: [],
    grade: 'A', overallScore: 88, violations: [], approved: true,
    voiceAlignment: {}, wins: [], improvements: [], trainingTopics: [],
    exampleParagraph: 'Mock paragraph.',
    theme: 'Mock Weekly Theme', tagline: 'Mock tagline',
    channels: { email:{priority:1}, social:{priority:2}, content:{priority:3} },
    kpis: [{ metric:'Conversions', target:'100' }],
    agentTasks: [], roadmap30Days: [], contentCalendarDays: [],
    masterUVP: 'Build passive income with ResidualVault',
    proofPoints: [], objectionHandlers: [], socialProofFormats: [],
    marketGaps: ['Gap 1'], differentiationOpportunities: ['Opp 1'],
    forecast: { next30Days:{low:'$5k',mid:'$8k',high:'$12k'} },
    revenueStreams: [], funnelBottlenecks: [], churnRisks: [],
    topPriorityActions: ['Action 1'],
    insight: 'Test insight', impact: 'High', action: 'Do this',
    todaysPriorities: [{ priority:1, action:'Test action', owner:'Team', impact:'High' }],
    riskDashboard: [],
    article: '<p>Mock thought leadership article</p>',
    linkedinVersion: 'Mock LinkedIn post',
    twitterThread: ['Mock tweet 1', 'Mock tweet 2'],
    keyTakeaways: ['Takeaway 1'],
    marketSize: { current:'$50B', projected:'$100B', cagr:'12%' },
    outlook: { bullCase:'Growth', bearCase:'Stable', baseCase:'Moderate growth' },
    contentIdeas: ['Idea 1', 'Idea 2'],
    questions: [], automations: [],
    surveyName: 'Mock NPS Survey',
    platforms: [], viralFormulas: [], contentPillars: ['Pillar 1'],
    discussionCount: 7,
    briefsCount: 5,
    securityScore: 92, immediateActions: [],
  }),
};

// ─── Patch BaseAgent.prototype.ask ───────────────────────────────────────────
const originalAsk = BaseAgent.prototype.ask;
BaseAgent.prototype.ask = async function(prompt) {
  // Return mock JSON wrapped in a code block so parseJSON works
  return '```json\n' + MOCK_RESPONSES.default + '\n```';
};
BaseAgent.prototype.chat = async function(messages, system) {
  return '```json\n' + MOCK_RESPONSES.default + '\n```';
};

// ─── Agent list ───────────────────────────────────────────────────────────────
const AGENTS = [
  'analytics-oracle',
  'brand-voice-auditor',
  'marketing-master-agent',
  'advertising-master-agent',
  'promotions-master-agent',
  'content-scheduler-agent',
  'revenue-intelligence-agent',
  'personalization-engine',
  'partnership-scout',
  'content-commander',
  'ad-strategist',
  'seo-architect',
  'community-voice',
  'email-conductor',
  'intelligence-scout',
  'industry-researcher',
  'master-strategist',
  'social-media-agent',
  'customer-success-agent',
  'cybersecurity-agent',
  'graphics-image-agent',
  'heygen-video-agent',
  'legal-compliance-agent',
  'crisis-response-agent',
];

// ─── Test runner ─────────────────────────────────────────────────────────────
async function runAgent(name) {
  const t0 = Date.now();
  try {
    const Cls  = require('./agents/' + name);
    const inst = new Cls();

    // Validate interface
    if (typeof inst.execute  !== 'function') throw new Error('execute() missing');
    if (typeof inst.run      !== 'function') throw new Error('run() missing');
    if (typeof inst.schedule !== 'string')   throw new Error('schedule not defined');
    if (!inst.name)                          throw new Error('name not defined');

    // For agents that call external APIs (OpenAI, HeyGen), patch those too
    if (inst.openai)   inst.openai   = { images: { generate: async () => ({ data: [{ url: 'https://mock-image.test/img.png', b64_json: null, revised_prompt: 'mock' }] }) } };
    if (inst.apiKey === 'test-placeholder') inst.apiKey = null; // Force HeyGen to skip

    // Run execute() with timeout
    const result = await Promise.race([
      inst.execute({}),
      new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT after 30s')), 30000)),
    ]);

    const ms = Date.now() - t0;
    return { name, ok: true, ms, result: JSON.stringify(result || {}).slice(0, 100) };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - t0, error: e.message };
  }
}

async function main() {
  console.log('='.repeat(65));
  console.log(' ResidualVault Agent Test Suite (Mock Mode)');
  console.log('='.repeat(65) + '\n');

  let passed = 0;
  let failed = 0;
  const failures = [];

  // Run in batches of 4 to avoid SQLite contention
  for (let i = 0; i < AGENTS.length; i += 4) {
    const batch   = AGENTS.slice(i, i + 4);
    const results = await Promise.all(batch.map(runAgent));

    for (const r of results) {
      if (r.ok) {
        console.log(`✅  ${r.name.padEnd(34)} ${r.ms}ms`);
        passed++;
      } else {
        console.error(`❌  ${r.name.padEnd(34)} ${r.ms}ms  →  ${r.error}`);
        failed++;
        failures.push(r);
      }
    }
  }

  console.log('\n' + '='.repeat(65));
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(65));

  if (failures.length) {
    console.log('\nFailed agents:');
    failures.forEach(f => console.log(`  ❌ ${f.name}: ${f.error}`));
    process.exit(1);
  } else {
    console.log('\n✅  All agents passed!');
    process.exit(0);
  }
}

main().catch(e => {
  console.error('Test harness error:', e);
  process.exit(1);
});
