# ResidualVault — System Reference

## Platform
ResidualVault (residualvault.com) — cryptocurrency staking comparison and intelligence platform. Tracks 156+ staking protocols with live APY data, risk analysis, and yield comparisons. Subscription tiers: Free, Starter, Pro, Premium via Stripe.

## Infrastructure
- Server: DigitalOcean droplet at 64.23.240.10
- OS: Ubuntu 24.04
- User: root (SSH), vaultadmin (app owner)
- SSH: ssh -i ~/.ssh/id_ed25519 root@64.23.240.10
- Stack: Node.js + PostgreSQL + PM2 + Nginx
- Project: /home/vaultadmin/residualvault/
- Database: postgresql://vaultuser:RVSecure2026@localhost:5432/residualvault
- GitHub: https://github.com/ResidualVault-jpg/residualvault-platform (branch: claude/build-ai-agent-system-e0Lfr)

## PM2 Processes

| Process | File | Port | Purpose |
|---------|------|------|---------|
| rv-api | index.js | 3000 | Main API + site |
| rv-scheduler | scheduler.js | — | All 31 agents + publishers on cron |
| rv-control | dashboard/rv-control.js | 3001 | Approval dashboard + agent command center |

## Dashboards
- residualvault.com/rv-control — Sunday content review queue, approve/reject
- residualvault.com/agent-control — Agent status, logs, metrics, manual triggers

---

## Architecture: Full In-House System

Everything is built in-house. No Make.com. No Canva API. No Airtable. No Buffer. No third-party automation platforms.

- AI Models: Anthropic Claude (Opus 4.6 for decision/strategy agents, Sonnet 4.6 for content/scanning agents)
- Database: PostgreSQL — agent_logs, agent_metrics, agent_reports, generated_content, content_posts, system_alerts
- Scheduling: node-cron in scheduler.js
- Logging: Winston with file rotation (logs/ directory)
- Publishing: socialPublisher.js (Twitter + LinkedIn), youtubePublisher.js (YouTube)
- Base Classes: agents/base-agent.js (main agents), agents/base-sub-agent.js (sub-agents)

---

## 31-Agent System

All agents live in /home/vaultadmin/residualvault/agents/ and are registered in scheduler.js.

### Sunday Batch — Weekly Content Generation
Runs every Sunday, staggered from 6:00 AM to 3:00 PM Denver time.

| Time | Agent | Model | Key |
|------|-------|-------|-----|
| 6:00 AM | Analytics Oracle | opus | analytics-oracle |
| 6:15 AM | Intelligence Scout | opus | intelligence-scout |
| 6:30 AM | Industry Researcher | opus | industry-researcher |
| 6:45 AM | Revenue Intelligence Agent | opus | revenue-intelligence |
| 7:00 AM | SEO Architect | opus | seo-architect |
| 7:00 AM | Twitter Content Creator | sonnet | twitter-content |
| 7:15 AM | Brand Voice Auditor | sonnet | brand-voice |
| 7:15 AM | LinkedIn Content Creator | sonnet | linkedin-content |
| 7:30 AM | Content Commander | opus | content-commander |
| 7:45 AM | Content Scheduler Agent | sonnet | content-scheduler |
| 7:45 AM | Social Media Agent | sonnet | social-media |
| 8:00 AM | Community Voice | sonnet | community-voice |
| 8:30 AM | Email Conductor | sonnet | email-conductor |
| 8:45 AM | Marketing Master Agent | opus | marketing-master |
| 9:00 AM | Advertising Master Agent | opus | advertising-master |
| 9:15 AM | Ad Strategist | opus | ad-strategist |
| 9:30 AM | Promotions Master Agent | sonnet | promotions-master |
| 9:45 AM | Partnership Scout | opus | partnership-scout |
| 10:00 AM | Personalization Engine | opus | personalization |
| 10:15 AM | Customer Success Agent | sonnet | customer-success |
| 10:30 AM | Legal and Compliance Guardian | opus | legal-compliance |
| 10:45 AM | Graphics/Image Agent | sonnet | graphics-image |
| 11:00 AM | Master Strategist | opus | master-strategist |
| 11:15 AM | Cybersecurity Agent | opus | cybersecurity |
| 11:30 AM | Infrastructure Security Scanner | sonnet | infra-security |
| 11:45 AM | Threat Intelligence Agent | sonnet | threat-intel |
| 3:00 PM | Veo Video Agent | sonnet | veo-video |

### Daily Agents

| Schedule | Agent | Model | Key |
|----------|-------|-------|-----|
| Every 15 min | Crisis Response Agent | sonnet | crisis-response |
| Daily 6:00 AM | User Testing Agent | sonnet | user-testing |
| Daily 6:30 AM | Fixer Agent | sonnet | fixer |
| Daily 5:00 AM | Meta Token Agent | sonnet | meta-token |

### Daily Publishers (not agents — scheduled in scheduler.js)

| Time | Publisher | Platforms |
|------|----------|-----------|
| 9:00 AM Denver | socialPublisher.js | Twitter/X + LinkedIn |
| 10:00 AM Denver | youtubePublisher.js | YouTube |

---

## Agent Roles

### Research and Intelligence
- **Industry Researcher** — Scans crypto, tech, finance news daily. Feeds intelligence to all other agents.
- **Intelligence Scout** — Competitor monitoring + trend identification. Weekly briefing.
- **Partnership Scout** — Identifies partnership opportunities in crypto/DeFi space.

### Content Creation
- **Content Commander** — Generates all social media content for the week (168+ posts across platforms).
- **Social Media Agent** — Platform-specific post optimization and formatting.
- **Twitter Content Creator** — Sub-agent: Twitter/X posts, threads, polls.
- **LinkedIn Content Creator** — Sub-agent: LinkedIn professional content.
- **SEO Architect** — Blog posts, keyword strategy, SEO reports.
- **Email Conductor** — Email sequences, newsletters, nurture campaigns via SendGrid.
- **Graphics/Image Agent** — Branded image generation for posts and campaigns.
- **Content Scheduler Agent** — 7-day content calendar, gap analysis, publishing cadence.
- **Brand Voice Auditor** — Checks all content for tone/voice consistency.

### Video Production
- **Veo Video Agent** — Cinematic marketing videos using Veo 3.1. Scripts, generates clips, coordinates post-production.

### Advertising and Revenue
- **Ad Strategist** — Paid ad copy and campaign management.
- **Advertising Master Agent** — Cross-channel ad coordination and budget optimization.
- **Promotions Master Agent** — Promotional campaigns and offers.
- **Revenue Intelligence Agent** — Revenue tracking, conversion analysis, pricing optimization.

### Analytics and Strategy
- **Analytics Oracle** — Site + social performance analytics. Daily reports.
- **Master Strategist** — Cross-agent strategy synthesis. Sunday briefing.
- **Marketing Master Agent** — Marketing coordination across all channels.
- **Personalization Engine** — User experience personalization based on behavior data.

### Community and Customer
- **Community Voice** — Social media engagement, community replies, relationship building.
- **Customer Success Agent** — Customer support, retention, onboarding flows.

### Security and Compliance
- **Cybersecurity Agent** — Application security scanning, vulnerability detection.
- **Infrastructure Security Scanner** — Server and infrastructure security audits.
- **Threat Intelligence Agent** — External threat monitoring and alerts.
- **Legal and Compliance Guardian** — Regulatory compliance checks for crypto/finance content.

### Operations
- **Crisis Response Agent** — Runs every 15 minutes. Incident detection and auto-response.
- **Fixer Agent** — Runs daily. Auto-fixes detected issues from other agents.
- **User Testing Agent** — UX testing scenarios and usability checks.

---

## Social Media Status

| Platform | Status | How |
|----------|--------|-----|
| Twitter/X | LIVE | socialPublisher.js via Twitter API v2 |
| LinkedIn | LIVE | socialPublisher.js via LinkedIn UGC API |
| YouTube | LIVE | youtubePublisher.js via YouTube Data API v3 |
| TikTok | PENDING | API review submitted. Credentials in .env. Publisher not built yet. |
| Instagram | PENDING | Meta app review submitted. Credentials in .env. Publisher not built yet. |
| Facebook | PENDING | Same Meta app as Instagram. Same token issue. |

### Meta App (Facebook + Instagram)
- App name: Residual Vault Automation
- App ID: 779634615214522
- Facebook Page ID: 61587437024840
- Instagram App ID: 905354658863483
- Current permissions: pages_show_list, pages_read_engagement
- MISSING permissions (need Meta approval): instagram_content_publish, instagram_basic
- Page Access Token: EXPIRED (March 6, 2026) — must regenerate at developers.facebook.com

### TikTok App
- Client Key in .env (TIKTOK_CLIENT_KEY)
- Status: API review submitted, awaiting approval

---

## Video and Graphics Production

### Artlist.io (Primary — Paid Subscription)
Used for ALL video and graphics work:
- Veo 3.1 — AI video generation with lip-synced dialogue, character casting
- Nano Banana 2 — Image generation for carousel slides and graphics
- Artlist Studio — Shot-by-shot directorial control, casting, character consistency
- Music Library — Licensed music and SFX for video projects
- Workflow: Generate clips in Artlist Studio, download, compose in Remotion, render final

### Remotion (Local Composition)
React video framework for post-production. Local project at: ~/Desktop/Residual Vault, LLC/rv-promo-video/
- Crossfade transitions, logo bookends, color grading, music mixing
- Preview: npm run preview | Render: npm run render
- Published videos stored in: ~/Desktop/Residual Vault, LLC/Residual Vault Videos/

### Retired: HeyGen
heygen-video-agent.js exists on server but is NOT in the scheduler. Fully replaced by Veo Video Agent using Artlist. Do not use. Can be deleted.

---

## Content Pipeline

RESEARCH (Daily/Weekly)
Industry Researcher + Intelligence Scout + Partnership Scout scan markets and competitors

GENERATE (Sunday batch)
Content Commander + sub-agents create week's content
SEO Architect creates blog posts
Email Conductor creates newsletters
Graphics/Image Agent creates branded images
Veo Video Agent creates marketing videos

REVIEW (Sunday evening)
All content saved to generated_content table with status pending_review
Owner reviews at residualvault.com/rv-control
Approve or Reject each piece

PUBLISH (Daily automated)
socialPublisher.js publishes to Twitter + LinkedIn at 9 AM Denver
youtubePublisher.js publishes to YouTube at 10 AM Denver
Instagram, TikTok, Facebook — pending API approval

ANALYZE (Ongoing)
Analytics Oracle tracks performance
Master Strategist synthesizes nightly action plan
Fixer Agent auto-remediates issues

---

## Database Tables

- agent_logs — Activity logs from all agents (agent_name, status, message, data)
- agent_reports — Structured reports (agent_name, report JSON)
- agent_metrics — Per-agent metrics (runs total, success/fail counts, duration, last run)
- generated_content — All AI content (agent_name, content_type, title, content, url, metadata with review status)
- content_posts — Scheduled posts (platform, content, status, scheduled_date, hashtags)
- system_alerts — Unresolved alerts (agent_name, type/severity, message, resolved flag)
- users — User accounts with subscription tiers
- staking_protocols — 156+ protocols with live APY data

---

## Credentials (.env)

All API keys and secrets in /home/vaultadmin/residualvault/.env — NEVER commit to git.

| Variable | Service |
|----------|---------|
| ANTHROPIC_API_KEY | Claude AI (all agents) |
| OPENAI_API_KEY | OpenAI (graphics agent) |
| GEMINI_API_KEY | Veo 3.1 video (server-side fallback) |
| TWITTER_API_KEY + TWITTER_API_SECRET | Twitter/X app |
| TWITTER_ACCESS_TOKEN + TWITTER_ACCESS_SECRET | Twitter/X publishing |
| LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET | LinkedIn app |
| LINKEDIN_ACCESS_TOKEN | LinkedIn publishing |
| YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET | YouTube app |
| YOUTUBE_ACCESS_TOKEN + YOUTUBE_REFRESH_TOKEN | YouTube publishing |
| META_APP_ID + META_APP_SECRET | Facebook/Instagram app |
| META_PAGE_ACCESS_TOKEN | Facebook Page publishing (EXPIRED) |
| META_PAGE_ID + META_USER_ID | Facebook Page identifiers |
| INSTAGRAM_APP_ID + INSTAGRAM_APP_SECRET | Instagram app |
| TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET | TikTok app |
| SENDGRID_API_KEY | Email delivery |
| STRIPE_SECRET_KEY + STRIPE_PUBLISHABLE_KEY | Payments |
| STRIPE price IDs | Starter/Pro/Premium monthly + yearly |
| DATABASE_URL | PostgreSQL connection |
| JWT_SECRET + ADMIN_PASSWORD | Auth |

---

## Quick Commands

```bash
# SSH to server
ssh -i ~/.ssh/id_ed25519 root@64.23.240.10

# PM2 (always run as vaultadmin)
su - vaultadmin -c 'pm2 list'
su - vaultadmin -c 'pm2 logs rv-scheduler --lines 50'
su - vaultadmin -c 'pm2 restart rv-scheduler'
su - vaultadmin -c 'pm2 restart rv-api'

# Trigger an agent manually
su - vaultadmin -c 'cd /home/vaultadmin/residualvault && node -e "require(\"./scheduler\").runAgent(\"content-commander\")"'

# Database access
psql postgresql://vaultuser:RVSecure2026@localhost:5432/residualvault

# Check agent metrics
# SELECT agent_name, metrics FROM agent_metrics ORDER BY updated_at DESC;

# View review queue
# SELECT id, agent_name, content_type, title FROM generated_content WHERE metadata->>'status' = 'pending_review' ORDER BY created_at DESC LIMIT 20;

# Check published posts
# SELECT id, platform, status, scheduled_date FROM content_posts WHERE status = 'published' ORDER BY updated_at DESC LIMIT 10;
```

---

## Pending Work

1. Instagram/Facebook publisher — Build once Meta approves instagram_content_publish permission. Refresh expired Page Access Token first.
2. TikTok publisher — Build once TikTok API approved.
3. Instagram carousel image generation — Wire Graphics/Image Agent to use Artlist Nano Banana 2 for multi-slide carousel images.
4. Partnership outreach automation pipeline — Partnership Scout generates leads but outreach is not automated.
5. Remove heygen-video-agent.js — Dead code, replaced by Veo Video Agent.

---

## Owner Preferences

- Act as rigorous honest mentor — identify weaknesses and blind spots
- Do not default to agreement — be direct and clear
- Prioritize helping improve over being agreeable
- All systems built in-house — no third-party automation platforms
- Use Artlist.io + Remotion for all video/graphics — never use Gemini API for media generation directly
- All data must use real sources and real physics — never Math.random() for measurements
