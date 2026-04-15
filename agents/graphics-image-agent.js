'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const OpenAI    = require('openai');
const path      = require('path');
const fs        = require('fs');

class GraphicsImageAgent extends BaseAgent {
  constructor() {
    super({
      name:      'Graphics/Image Agent',
      role:      'You are a creative director and visual strategist specializing in digital marketing visuals. You craft precise image generation prompts and manage visual content for ResidualVault\'s marketing channels.',
      model:     'claude-opus-4-6',
      schedule:  '45 10 * * 0',  // Sunday content batch (America/Denver)
      timezone:  'America/Denver',
      maxTokens: 2048,
    });

    // Route OpenAI calls through proxy if configured
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.GLOBAL_AGENT_HTTP_PROXY || '';
    const openAiOpts = { apiKey: process.env.OPENAI_API_KEY };
    if (proxyUrl) {
      try {
        const { HttpsProxyAgent } = require('https-proxy-agent');
        openAiOpts.httpAgent = new HttpsProxyAgent(proxyUrl);
      } catch (_) {}
    }
    this.openai = new OpenAI(openAiOpts);
    this.imageModel = 'dall-e-3'; // gpt-image-1 requires special access; dall-e-3 is standard

    // Output directory for generated images
    this.outputDir = path.join(__dirname, '../data/generated-images');
    if (!fs.existsSync(this.outputDir)) fs.mkdirSync(this.outputDir, { recursive: true });
  }

  /**
   * Generate an image using OpenAI gpt-image-1.
   * @param {string} prompt
   * @param {object} options
   * @returns {{ url: string, b64: string|null }}
   */
  async generateImage(prompt, options = {}) {
    const response = await this.openai.images.generate({
      model:   this.imageModel,
      prompt,
      n:       1,
      size:    options.size    || '1024x1024',
      quality: options.quality || 'standard',
      ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
    });

    const item = response.data[0];
    return {
      url:         item.url         || null,
      b64:         item.b64_json    || null,
      revisedPrompt: item.revised_prompt || prompt,
    };
  }

  /** Ask Claude to craft optimised image prompts for each content need */
  async craftPrompts(contentNeeds) {
    const raw = await this.ask(`
You are crafting image generation prompts for the ResidualVault brand.

Brand identity:
- Modern, professional, wealth-building focus
- Colors: deep navy, gold accents, clean white
- Tone: aspirational yet attainable, trustworthy
- Audience: entrepreneurs and passive income seekers

Content needs: ${JSON.stringify(contentNeeds)}

For EACH content need, produce one optimised prompt for gpt-image-1.
Output JSON array:
[
  {
    "need": "string",
    "prompt": "string (detailed, style-specific, brand-aligned)",
    "size": "1024x1024|1792x1024|1024x1792",
    "filename": "snake_case_filename_no_extension"
  }
]
`);
    const parsed = this.parseJSON(raw);
    return Array.isArray(parsed) ? parsed : [];
  }

  async execute(context = {}) {
    if (!process.env.OPENAI_API_KEY) {
      this._log('warning', 'OPENAI_API_KEY not set — skipping image generation');
      return { skipped: true, reason: 'missing_api_key' };
    }

    // Default daily content needs
    const contentNeeds = context.contentNeeds || [
      'Hero banner for homepage promoting passive income',
      'Social media post graphic — weekly motivational quote',
      'Email newsletter header — financial freedom theme',
      'Blog post featured image — digital marketing strategies',
    ];

    this._log('info', `Generating ${contentNeeds.length} images`);

    const prompts  = await this.craftPrompts(contentNeeds);
    const results  = [];

    for (const item of prompts) {
      try {
        this._log('info', `Generating: ${item.need}`);
        const img = await this.generateImage(item.prompt, { size: item.size });

        // Save b64 to disk if available
        let savedPath = null;
        if (img.b64) {
          savedPath = path.join(this.outputDir, `${item.filename}_${Date.now()}.png`);
          fs.writeFileSync(savedPath, Buffer.from(img.b64, 'base64'));
        }

        await this.saveContent(
          'image',
          item.need,
          img.revisedPrompt,
          img.url || savedPath,
          { originalPrompt: item.prompt, size: item.size, savedPath }
        );

        results.push({ need: item.need, url: img.url, savedPath, success: true });
      } catch (err) {
        this._log('error', `Image generation failed for "${item.need}": ${err.message}`);
        results.push({ need: item.need, success: false, error: err.message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    await this.saveReport(
      'image-generation',
      `Daily Image Generation — ${successCount}/${results.length} succeeded`,
      JSON.stringify(results, null, 2),
      successCount < results.length ? 'high' : 'normal'
    );

    return { generated: successCount, total: results.length, results };
  }
}

module.exports = GraphicsImageAgent;

if (require.main === module) {
  const agent = new GraphicsImageAgent();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
