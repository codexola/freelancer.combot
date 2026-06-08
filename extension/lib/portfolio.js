/**
 * 過去プロジェクトリンクの textarea 解析と入札文の1500文字制限
 */

export const MAX_PROPOSAL_LENGTH = 1500;

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
  'swift', 'kotlin', 'django', 'flask', 'fastapi', 'express', 'nuxt', 'svelte'
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

export function selectRelevantLinks(project, links, maxLinks = 3) {
  if (!links?.length) return [];

  const projectText = `${project.title || ''} ${project.description || ''} ${(project.skills || []).join(' ')}`.toLowerCase();

  const scored = links.map((link) => {
    let score = 0;
    const linkText = `${link.url} ${link.title || ''} ${link.description || ''} ${(link.tags || []).join(' ')}`.toLowerCase();

    for (const skill of project.skills || []) {
      if (linkText.includes(skill.toLowerCase())) score += 3;
    }
    for (const tag of link.tags || []) {
      if (projectText.includes(tag.toLowerCase())) score += 2;
    }

    const words = projectText.split(/\W+/).filter((w) => w.length > 3);
    for (const word of words) {
      if (linkText.includes(word)) score += 1;
    }

    return { link, score };
  });

  const relevant = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);

  if (relevant.length) {
    return relevant.slice(0, maxLinks).map((s) => s.link);
  }

  return [];
}

export function enforceProposalLimit(text, maxLen = MAX_PROPOSAL_LENGTH) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen);
}

export function finalizeProposal(proposalText, project, settings) {
  const allLinks = getPortfolioLinks(settings);
  const relevantLinks = selectRelevantLinks(project, allLinks);
  let proposal = (proposalText || '').trim();

  const missingLinks = relevantLinks.filter((l) => !proposal.includes(l.url));

  if (missingLinks.length) {
    const urls = missingLinks.map((l) => l.url);
    const linksBlock = `\n\nRelevant work:\n${urls.join('\n')}`;
    const totalLen = proposal.length + linksBlock.length;

    if (totalLen <= MAX_PROPOSAL_LENGTH) {
      proposal += linksBlock;
    } else {
      const reservedForLinks = urls.join('\n');
      const header = '\n\nRelevant work:\n';
      const availableForText = MAX_PROPOSAL_LENGTH - header.length - reservedForLinks.length;

      if (availableForText > 80) {
        proposal = proposal.slice(0, availableForText).trimEnd() + header + reservedForLinks;
      } else {
        let fitted = proposal;
        for (const url of urls) {
          const addition = (fitted.includes('Relevant work') ? '\n' : '\n\nRelevant work:\n') + url;
          if (fitted.length + addition.length <= MAX_PROPOSAL_LENGTH) {
            if (!fitted.includes('Relevant work')) fitted += '\n\nRelevant work:\n';
            else fitted += '\n';
            fitted += url;
          }
        }
        proposal = fitted;
      }
    }
  }

  return enforceProposalLimit(proposal, MAX_PROPOSAL_LENGTH);
}
