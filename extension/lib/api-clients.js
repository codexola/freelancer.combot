/**
 * Claude / OpenAI API クライアント — 入札文生成
 */

import {
  detectProjectLanguage,
  getProposalLanguageInstruction,
  analyzeProjectRequirements
} from './filters.js';
import {
  getPortfolioLinks,
  selectRelevantLinks,
  finalizeProposal,
  finalizeProposalSignature,
  enforceProposalLimit,
  buildProjectAnalysisSummary,
  getProposalLengthBounds,
  MAX_PROPOSAL_LENGTH,
  MIN_PORTFOLIO_LINKS,
  MAX_PORTFOLIO_LINKS
} from './portfolio.js';

const DEFAULT_PROPOSAL_PROMPT = `You are an expert freelancer on Freelancer.com.

Write a persuasive bid proposal that:
1. Analyzes the client's specific requirements from the project title and description
2. Explains clearly how you will deliver exactly what they need (scope, approach, timeline)
3. Highlights relevant experience without generic fluff
4. Naturally embeds 2-3 portfolio links from the provided list (only the most relevant ones)
5. Ends with a professional call to action inviting the client to discuss details`;

const STYLE_HINTS = {
  professional: 'Tone: confident, professional, concise.',
  friendly: 'Tone: warm, approachable, collaborative.',
  technical: 'Tone: technical, precise, solution-oriented with concrete deliverables.'
};

async function callWithFallback(settings, prompt) {
  const provider = settings.preferredAiProvider || 'claude';
  const attempts = [];

  if (provider === 'claude') {
    if (settings.claudeApiKey) attempts.push(() => callClaude(settings.claudeApiKey, prompt));
    if (settings.openaiApiKey) attempts.push(() => callOpenAI(settings.openaiApiKey, prompt));
  } else {
    if (settings.openaiApiKey) attempts.push(() => callOpenAI(settings.openaiApiKey, prompt));
    if (settings.claudeApiKey) attempts.push(() => callClaude(settings.claudeApiKey, prompt));
  }

  if (!attempts.length) {
    throw new Error('Claude または OpenAI の API キーをダッシュボードに設定してください');
  }

  let lastError = null;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('入札文の生成に失敗しました');
}

export async function generateProposal(settings, projectData) {
  const portfolioLinks = getPortfolioLinks(settings);
  const selectedLinks = selectRelevantLinks(projectData, portfolioLinks, MIN_PORTFOLIO_LINKS, MAX_PORTFOLIO_LINKS);
  const { minLen, targetMax, hardMax } = getProposalLengthBounds(settings);

  const prompt = buildProposalPrompt(projectData, settings, selectedLinks);
  let rawText = await callWithFallback(settings, prompt);

  if (!rawText?.trim()) {
    throw new Error('AIが空の入札文を返しました');
  }

  let finalized = finalizeProposal(rawText, projectData, settings, selectedLinks);

  if (finalized.length < minLen) {
    const expandPrompt = `${prompt}

IMPORTANT: Your previous draft was only ${finalized.length} characters. Rewrite the FULL proposal with ${minLen}-${targetMax} characters (hard maximum ${hardMax}). Add more specific detail about how you will meet each client requirement. Do not use markdown.`;
    rawText = await callWithFallback(settings, expandPrompt);
    finalized = finalizeProposal(rawText, projectData, settings, selectedLinks);
  }

  if (finalized.length < minLen) {
    throw new Error(`入札文が短すぎます (${finalized.length}文字 / 最低${minLen}文字)`);
  }

  if (finalized.length > hardMax) {
    finalized.text = enforceProposalLimit(finalized.text, hardMax);
    finalized.length = finalized.text.length;
  }

  const signed = finalizeProposalSignature(finalized.text, settings, hardMax);
  return signed;
}

function buildProposalPrompt(project, settings, selectedLinks) {
  const { minLen, targetMax, hardMax } = getProposalLengthBounds(settings);
  const customPrompt = settings.proposalPrompt?.trim() || DEFAULT_PROPOSAL_PROMPT;
  const styleHint = STYLE_HINTS[settings.proposalStyle] || STYLE_HINTS.professional;
  const requirementAnalysis = analyzeProjectRequirements(project);
  const clientLanguage = detectProjectLanguage(project);
  const languageInstruction = getProposalLanguageInstruction(project);
  const projectSummary = buildProjectAnalysisSummary(project);

  const linksBlock = selectedLinks.length
    ? selectedLinks
        .map(
          (l, i) =>
            `${i + 1}. ${l.url}${l.description ? ` — ${l.description}` : l.title ? ` — ${l.title}` : ''}`
        )
        .join('\n')
    : 'None available — do not invent URLs';

  const mustIncludeLinks =
    selectedLinks.length >= MIN_PORTFOLIO_LINKS
      ? `Include exactly ${Math.min(selectedLinks.length, MAX_PORTFOLIO_LINKS)} of these portfolio URLs inline in the proposal:`
      : selectedLinks.length
        ? `Include these portfolio URL(s) inline where relevant:`
        : 'No portfolio links available.';

  return `${customPrompt}

${styleHint}
${languageInstruction}
Client/ad language: ${clientLanguage}

## Project analysis
Primary work type: ${requirementAnalysis.primaryType}
Requirement summary: ${requirementAnalysis.summary}

## Client project (analyze every requirement before writing)
${projectSummary}

## Portfolio links to use (${MIN_PORTFOLIO_LINKS}-${MAX_PORTFOLIO_LINKS} most relevant only)
${mustIncludeLinks}
${linksBlock}

## Length rules (STRICT)
- Total length including URLs must be between ${minLen} and ${targetMax} characters
- NEVER exceed ${hardMax} characters (Freelancer hard limit ${MAX_PROPOSAL_LENGTH})
- Count every character including spaces and line breaks
- Write ${minLen}-${targetMax} characters — not shorter, not longer

## Closing / signature (CRITICAL)
- Do NOT include any sign-off or closing line
- Do NOT write "Best regards", "Best,", "Sincerely", "[Your Name]", or "Your Name"
- Do NOT include the freelancer's name at the end — the system adds "Best regards, {name}" automatically

## Output
Return ONLY the final bid proposal text. No markdown, no headings, no "Here is your proposal", no explanations.`;
}

async function callClaude(apiKey, prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2200,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error: ${res.status} ${err}`);
  }
  const data = await res.json();
  return cleanAiOutput(data.content?.[0]?.text || '');
}

async function callOpenAI(apiKey, prompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 2200,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error: ${res.status} ${err}`);
  }
  const data = await res.json();
  return cleanAiOutput(data.choices?.[0]?.message?.content || '');
}

function cleanAiOutput(text) {
  return text
    .replace(/^```[\w]*\n?/gm, '')
    .replace(/```$/gm, '')
    .replace(/^\s*here(?:'s| is) (?:your |the )?proposal:?\s*/i, '')
    .trim();
}

const WORKFLOW_REFERENCE = `
既知のワークフロー:
1. プロジェクト一覧(f8): 新規プロジェクト検出
2. 固定価格入札(f7): 金額、納期、プロフィール、提案文、Place Bid
3. 時給入札(f6): 時給、プロフィール、提案文、Place Bid
4. IP Agreement(f4-f5): 署名・氏名・住所 → Submit Document
`;

export async function analyzeProblem(settings, screenshotBase64, context) {
  const prompt = `Freelancer.comの自動入札中に問題が発生しました。スクリーンショットと状況を分析し、解決手順をJSON形式で返してください。

${WORKFLOW_REFERENCE}

## 状況
${context}

## 出力形式（JSONのみ）
{
  "problem": "問題の説明",
  "solution": "解決方法",
  "actions": [
    { "type": "click", "selector": "CSSセレクタ", "description": "説明" },
    { "type": "fill", "selector": "CSSセレクタ", "value": "入力値", "description": "説明" },
    { "type": "wait", "ms": 1000, "description": "説明" },
    { "type": "drawSignature", "description": "署名を描画" }
  ],
  "canAutoResolve": true
}`;

  const provider = settings.preferredAiProvider || 'claude';
  const apiKey = provider === 'claude' ? settings.claudeApiKey : settings.openaiApiKey;
  const fallbackKey = provider === 'claude' ? settings.openaiApiKey : settings.claudeApiKey;

  try {
    if (provider === 'claude' && apiKey) {
      return await callClaudeVision(apiKey, prompt, screenshotBase64);
    }
    if (apiKey) {
      return await callOpenAIVision(apiKey, prompt, screenshotBase64);
    }
    throw new Error('APIキー未設定');
  } catch (err) {
    if (fallbackKey) {
      if (provider === 'claude') {
        return await callOpenAIVision(fallbackKey, prompt, screenshotBase64);
      }
      return await callClaudeVision(fallbackKey, prompt, screenshotBase64);
    }
    throw err;
  }
}

async function callClaudeVision(apiKey, prompt, imageBase64) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 } },
            { type: 'text', text: prompt }
          ]
        }
      ]
    })
  });
  if (!res.ok) throw new Error(`Claude Vision error: ${res.status}`);
  const data = await res.json();
  return parseAnalysisResponse(data.content?.[0]?.text || '');
}

async function callOpenAIVision(apiKey, prompt, imageBase64) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } }
          ]
        }
      ]
    })
  });
  if (!res.ok) throw new Error(`OpenAI Vision error: ${res.status}`);
  const data = await res.json();
  return parseAnalysisResponse(data.choices?.[0]?.message?.content || '');
}

function parseAnalysisResponse(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return { problem: text, solution: '', actions: [], canAutoResolve: false };
    }
  }
  return { problem: text, solution: '', actions: [], canAutoResolve: false };
}
