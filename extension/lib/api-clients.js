/**
 * Claude / OpenAI API クライアント
 */

import { detectProjectLanguage, getProposalLanguageInstruction } from './filters.js';

export async function generateProposal(settings, projectData) {
  const prompt = buildProposalPrompt(projectData, settings);
  const provider = settings.preferredAiProvider || 'claude';

  try {
    if (provider === 'claude' && settings.claudeApiKey) {
      return await callClaude(settings.claudeApiKey, prompt);
    }
    if (settings.openaiApiKey) {
      return await callOpenAI(settings.openaiApiKey, prompt);
    }
    if (settings.claudeApiKey) {
      return await callClaude(settings.claudeApiKey, prompt);
    }
    throw new Error('APIキーが設定されていません');
  } catch (err) {
    if (provider === 'claude' && settings.openaiApiKey) {
      return await callOpenAI(settings.openaiApiKey, prompt);
    }
    if (provider === 'openai' && settings.claudeApiKey) {
      return await callClaude(settings.claudeApiKey, prompt);
    }
    throw err;
  }
}

function buildProposalPrompt(project, settings) {
  const relevantLinks = selectRelevantLinks(project, settings.portfolioLinks || []);
  const linksText = relevantLinks.length
    ? relevantLinks.map((l) => `- ${l.title}: ${l.url} (${l.description || ''})`).join('\n')
    : 'None';

  const clientLanguage = detectProjectLanguage(project);
  const languageInstruction = getProposalLanguageInstruction(project);

  return `You are a freelancer on Freelancer.com. Write a bid proposal for the project below.

## Constraints
- Maximum 1500 characters (strict)
- Include only portfolio links most relevant to the client's requirements
- Use a natural, persuasive ${settings.proposalStyle || 'professional'} tone
- Language rule: English is the standard default. ${languageInstruction}
- Detected client/ad language: ${clientLanguage}

## Project
Title: ${project.title}
Description: ${project.description}
Budget: ${project.budget}
Skills: ${(project.skills || []).join(', ')}
Bid type: ${project.bidType || 'fixed'}
Client country: ${project.clientCountry || 'unknown'}

## Available portfolio links (include only relevant ones)
${linksText}

## Output
Return only the proposal text. No explanations or markdown.`;
}

function selectRelevantLinks(project, portfolioLinks) {
  if (!portfolioLinks.length) return [];
  const projectText = `${project.title} ${project.description} ${(project.skills || []).join(' ')}`.toLowerCase();
  return portfolioLinks
    .filter((link) => {
      const tags = (link.tags || []).map((t) => t.toLowerCase());
      return tags.some((tag) => projectText.includes(tag));
    })
    .slice(0, 3);
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
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error: ${res.status} ${err}`);
  }
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  return text.slice(0, 1500);
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
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error: ${res.status} ${err}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  return text.slice(0, 1500);
}

const WORKFLOW_REFERENCE = `
既知のワークフロー:
1. プロジェクト一覧(f8): 新規プロジェクト検出、入札者数<50、投稿3-10秒以内
2. 固定価格入札(f7): 金額、納期、プロフィール、提案文(1500文字)、Place Bid
3. 時給入札(f6): 時給、プロフィール、提案文、Place Bid
4. IP Agreement(f4): +Add Signature, +Add Full Name ボタンをクリック
5. 署名モーダル(f2): canvasに署名を描画し「Add Signature」クリック
6. 契約書(f1,f3,f5): Signature, Full Name, Full Address を追加後 Submit Document
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
