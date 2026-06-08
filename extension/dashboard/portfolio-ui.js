/**
 * ダッシュボード用ポートフォリオ textarea ユーティリティ
 */

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

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
      return { url, description: rest };
    })
    .filter(Boolean);
}

export function portfolioLinksToText(links) {
  if (!links?.length) return '';
  return links
    .map((l) => {
      if (l.description) return `${l.url} | ${l.description}`;
      if (l.title && l.title !== l.url) return `${l.url} | ${l.title}`;
      return l.url;
    })
    .join('\n');
}

export function getPortfolioTextFromSettings(settings) {
  if (settings.portfolioLinksText?.trim()) {
    return settings.portfolioLinksText;
  }
  return portfolioLinksToText(settings.portfolioLinks || []);
}
