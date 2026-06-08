/**
 * 過去プロジェクトリンクの解析と入札文の文字数制御
 */

export const MIN_PROPOSAL_LENGTH = 1000;
export const TARGET_MAX_PROPOSAL_LENGTH = 1400;
export const MAX_PROPOSAL_LENGTH = 1500;
export const MIN_PORTFOLIO_LINKS = 2;
export const MAX_PORTFOLIO_LINKS = 3;

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

const TECH_KEYWORDS = [
  'react', 'vue', 'angular', 'nextjs', 'next.js', 'node', 'nodejs', 'python',
  'php', 'laravel', 'wordpress', 'shopify', 'woocommerce', 'magento',
  'javascript', 'typescript', 'html', 'css', 'tailwind', 'bootstrap',
  'seo', 'api', 'mobile', 'ios', 'android', 'flutter', 'react native',
  'database', 'mysql', 'mongodb', 'postgresql', 'aws', 'azure', 'docker',
  'kubernetes', 'netlify', 'vercel', 'astro', 'gatsby', 'figma', 'ui', 'ux',
  'design', 'logo', 'branding', 'ecommerce', 'e-commerce', 'saas', 'crm',
  'automation', 'scraping', 'machine learning', 'ai', 'blockchain', 'solidity',
  'java', 'spring', 'c#', '.net', 'ruby', 'rails', 'go', 'golang', 'rust',
  'swift', 'kotlin', 'django', 'flask', 'fastapi', 'express', 'nuxt', 'svelte',
  'elementor', 'woocommerce', 'web development', 'website'
];

export function parsePortfolioLinksText(text) {
  if (!text?.trim()) return [];

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const urls = line.match(URL_REGEX);
      if (!urls?.length) return null;

      const url = urls[0];
      const rest = line.replace(url, '').replace(/^[\s|\-–—:,#]+/, '').trim();
      const parts = rest.split('|').map((p) => p.trim()).filter(Boolean);
      const title = parts[0] || extractTitleFromUrl(url);
      const description = parts.slice(1).join(' | ') || rest;

      return {
        url,
        title,
        description: description || title,
        tags: inferTags(`${title} ${description}`, url)
      };
    })
    .filter(Boolean);
}

function extractTitleFromUrl(url) {
  try {
    const path = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    return path.replace(/[-_]/g, ' ').replace(/\.\w+$/, '') || url;
  } catch {
    return url;
  }
}

function inferTags(text, url) {
  const combined = `${text} ${url}`.toLowerCase();
  const tags = TECH_KEYWORDS.filter((kw) => combined.includes(kw));
  const words = combined.split(/[^a-z0-9+.#]+/).filter((w) => w.length > 3);
  return [...new Set([...tags, ...words.slice(0, 5)])];
}

export function getPortfolioLinks(settings) {
  if (settings?.portfolioLinksText?.trim()) {
    return parsePortfolioLinksText(settings.portfolioLinksText);
  }
  return settings?.portfolioLinks || [];
}

export function portfolioLinksToText(links) {
  if (!links?.length) return '';
  return links
    .map((l) => {
      if (l.description && l.description !== l.title) {
        return `${l.url} | ${l.description}`;
      }
      if (l.title && l.title !== l.url) {
        return `${l.url} | ${l.title}`;
      }
      return l.url;
    })
    .join('\n');
}

export function scorePortfolioLink(project, link) {
  let score = 0;
  const projectText = `${project.title || ''} ${project.description || ''} ${(project.skills || []).join(' ')}`.toLowerCase();
  const linkText = `${link.url} ${link.title || ''} ${link.description || ''} ${(link.tags || []).join(' ')}`.toLowerCase();

  for (const skill of project.skills || []) {
    if (linkText.includes(skill.toLowerCase())) score += 4;
  }
  for (const tag of link.tags || []) {
    if (projectText.includes(tag.toLowerCase())) score += 3;
  }

  const words = projectText.split(/\W+/).filter((w) => w.length > 3);
  for (const word of words) {
    if (linkText.includes(word)) score += 1;
  }

  return score;
}

export function selectRelevantLinks(project, links, minLinks = MIN_PORTFOLIO_LINKS, maxLinks = MAX_PORTFOLIO_LINKS) {
  if (!links?.length) return [];

  const scored = links
    .map((link) => ({ link, score: scorePortfolioLink(project, link) }))
    .sort((a, b) => b.score - a.score);

  const picked = [];
  for (const { link, score } of scored) {
    if (picked.length >= maxLinks) break;
    if (score > 0 || picked.length < minLinks) {
      picked.push(link);
    }
  }

  for (const { link } of scored) {
    if (picked.length >= maxLinks) break;
    if (!picked.includes(link)) picked.push(link);
  }

  return picked.slice(0, maxLinks);
}

export function getProposalLengthBounds(settings) {
  const minLen = settings.proposalMinLength ?? MIN_PROPOSAL_LENGTH;
  const targetMax = settings.proposalMaxLength ?? TARGET_MAX_PROPOSAL_LENGTH;
  const hardMax = MAX_PROPOSAL_LENGTH;
  return {
    minLen: Math.max(500, minLen),
    targetMax: Math.min(hardMax, Math.max(minLen, targetMax)),
    hardMax
  };
}

export function enforceProposalLimit(text, maxLen = MAX_PROPOSAL_LENGTH) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  const trimmed = text.slice(0, maxLen);
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace > maxLen * 0.85) {
    return trimmed.slice(0, lastSpace).trimEnd();
  }
  return trimmed.trimEnd();
}

function appendPortfolioLinks(proposal, links, hardMax) {
  if (!links?.length) return proposal;

  let result = proposal.trim();
  const missing = links.filter((l) => !result.includes(l.url));

  if (!missing.length) return result;

  const header = '\n\nRelevant past work:\n';
  const linkLines = missing.map((l) => {
    const desc = l.description && l.description !== l.title ? ` — ${l.description}` : '';
    return `${l.url}${desc}`;
  });

  for (const line of linkLines) {
    const addition = (result.includes('Relevant past work') ? '\n' : header) + line;
    if (result.length + addition.length <= hardMax) {
      if (!result.includes('Relevant past work')) result += header;
      else result += '\n';
      result += line.replace(/^Relevant past work:\n/, '');
    }
  }

  return result.trim();
}

export function finalizeProposal(proposalText, project, settings, selectedLinks) {
  const { minLen, targetMax, hardMax } = getProposalLengthBounds(settings);
  const links =
    selectedLinks || selectRelevantLinks(project, getPortfolioLinks(settings));

  let proposal = (proposalText || '').trim();
  proposal = appendPortfolioLinks(proposal, links, hardMax);

  if (proposal.length > targetMax) {
    proposal = enforceProposalLimit(proposal, targetMax);
  }
  if (proposal.length > hardMax) {
    proposal = enforceProposalLimit(proposal, hardMax);
  }

  return {
    text: proposal,
    length: proposal.length,
    linksUsed: links.map((l) => l.url),
    withinRange: proposal.length >= minLen && proposal.length <= hardMax,
    minLen,
    targetMax,
    hardMax
  };
}

const PLACEHOLDER_SIGNOFF_PATTERNS = [
  /\n*\s*best\s*,\s*\[?\s*your\s+name\s*\]?\s*\.?\s*$/gi,
  /\n*\s*best\s+regards\s*,\s*\[?\s*your\s+name\s*\]?\s*\.?\s*$/gi,
  /\n*\s*best\s*,\s*your\s+name\s*\.?\s*$/gi,
  /\n*\s*best\s+regards\s*,\s*your\s+name\s*\.?\s*$/gi,
  /\n*\s*regards\s*,\s*\[?\s*your\s+name\s*\]?\s*\.?\s*$/gi,
  /\n*\s*sincerely\s*,\s*\[?\s*your\s+name\s*\]?\s*\.?\s*$/gi,
  /\n*\s*kind\s+regards\s*,\s*\[?\s*your\s+name\s*\]?\s*\.?\s*$/gi,
  /\n*\s*best\s*,\s*$/gi,
  /\n*\s*best\s+regards\s*,\s*$/gi
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function stripPlaceholderSignoffs(text) {
  if (!text) return '';
  let result = text.trimEnd();
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of PLACEHOLDER_SIGNOFF_PATTERNS) {
      const next = result.replace(pattern, '').trimEnd();
      if (next !== result) {
        result = next;
        changed = true;
      }
    }
  }
  return result;
}

export function finalizeProposalSignature(proposal, settings, maxLen = MAX_PROPOSAL_LENGTH) {
  const name = settings?.fullName?.trim();
  let text = stripPlaceholderSignoffs(proposal || '');

  if (!name) {
    return enforceProposalLimit(text, maxLen);
  }

  const namePatterns = [
    new RegExp(`\\n*\\s*best\\s*,\\s*${escapeRegExp(name)}\\s*\\.?\\s*$`, 'i'),
    new RegExp(`\\n*\\s*best\\s+regards\\s*,\\s*${escapeRegExp(name)}\\s*\\.?\\s*$`, 'i'),
    new RegExp(`\\n*\\s*sincerely\\s*,\\s*${escapeRegExp(name)}\\s*\\.?\\s*$`, 'i'),
    new RegExp(`\\n*\\s*regards\\s*,\\s*${escapeRegExp(name)}\\s*\\.?\\s*$`, 'i')
  ];

  for (const pattern of namePatterns) {
    text = text.replace(pattern, '').trimEnd();
  }

  const closing = `\n\nBest regards,\n${name}`;
  if (/\n\s*best\s+regards\s*,\s*$/i.test(text)) {
    text = text.replace(/\n\s*best\s+regards\s*,\s*$/i, '').trimEnd();
  }

  if (text.toLowerCase().endsWith(name.toLowerCase())) {
    const beforeName = text.slice(0, -name.length).trimEnd();
    if (/best\s+regards\s*,?\s*$/i.test(beforeName)) {
      return enforceProposalLimit(text, maxLen);
    }
  }

  if (text.length + closing.length <= maxLen) {
    return text + closing;
  }
  const trimmed = text.slice(0, Math.max(0, maxLen - closing.length)).trimEnd();
  return trimmed + closing;
}

export function buildProjectAnalysisSummary(project) {
  const skills = (project.skills || []).join(', ');
  const parts = [
    `Title: ${project.title || 'N/A'}`,
    `Description: ${project.description || 'N/A'}`,
    `Budget: ${project.budget || 'N/A'}`,
    `Type: ${project.bidType || 'fixed'}`,
    `Skills: ${skills || 'N/A'}`,
    `Client country: ${project.clientCountry || 'unknown'}`
  ];
  return parts.join('\n');
}
