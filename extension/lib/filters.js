/**
 * プロジェクトフィルタリング
 * - 最低価格 $100 USD
 * - インド・パキスタン・アフリカ諸国を除外
 * - マーケティング・成人コンテンツ・仮想秘書案件を除外
 */

export const EXCLUDED_CATEGORY_RULES = [
  {
    id: 'marketing',
    label: 'マーケティング',
    keywords: [
      'marketing', 'digital marketing', 'social media marketing', 'email marketing',
      'content marketing', 'influencer marketing', 'affiliate marketing',
      'facebook ads', 'google ads', 'instagram ads', 'tiktok ads', 'ppc',
      'lead generation', 'brand awareness', 'marketing campaign', 'marketing strategy',
      'social media management', 'smm', 'seo marketing', 'promotion campaign',
      'market research', 'growth hacking', 'media buying', 'ad campaign',
      'マーケティング', '広告運用', '集客'
    ]
  },
  {
    id: 'adult',
    label: '成人コンテンツ',
    keywords: [
      'adult content', 'adult website', 'adult site', 'adult video', 'adult entertainment',
      'porn', 'pornography', 'pornographic', 'xxx', 'nsfw', 'erotic', 'erotica',
      'escort', 'onlyfans', 'webcam model', 'cam girl', 'cam site', 'nude', 'nudity',
      'sex site', 'sex chat', 'adult chat', '18+', 'mature content', 'x-rated',
      '成人', 'アダルト', 'エロ', '風俗'
    ]
  },
  {
    id: 'virtual_assistant',
    label: '仮想秘書',
    keywords: [
      'virtual assistant', 'virtual secretary', 'hire a va', 'hiring a va',
      'need a va', 'looking for va', 'personal assistant', 'executive assistant',
      'administrative assistant', 'online assistant', 'remote assistant',
      'office assistant', 'secretary needed', 'hire assistant', 'hiring assistant',
      'virtual admin', 'va support', 'data entry assistant', 'customer support assistant',
      '仮想秘書', 'バーチャルアシスタント', 'オンライン秘書', 'リモート秘書'
    ]
  }
];

export const DEFAULT_EXCLUDED_COUNTRIES = [
  'india',
  'pakistan',
  'algeria', 'angola', 'benin', 'botswana', 'burkina faso', 'burundi',
  'cameroon', 'cape verde', 'central african republic', 'chad', 'comoros',
  'congo', 'democratic republic of the congo', 'djibouti', 'egypt',
  'equatorial guinea', 'eritrea', 'eswatini', 'ethiopia', 'gabon',
  'gambia', 'ghana', 'guinea', 'guinea-bissau', 'ivory coast', "cote d'ivoire",
  "côte d'ivoire", 'kenya', 'lesotho', 'liberia', 'libya', 'madagascar',
  'malawi', 'mali', 'mauritania', 'mauritius', 'morocco', 'mozambique',
  'namibia', 'niger', 'nigeria', 'rwanda', 'senegal', 'seychelles',
  'sierra leone', 'somalia', 'south africa', 'south sudan', 'sudan',
  'tanzania', 'togo', 'tunisia', 'uganda', 'zambia', 'zimbabwe'
];

const CURRENCY_TO_USD = {
  USD: 1, US: 1, '$': 1,
  EUR: 1.08, '€': 1.08,
  GBP: 1.27, '£': 1.27,
  AUD: 0.65, A$: 0.65,
  CAD: 0.74, C$: 0.74,
  NZD: 0.60,
  INR: 0.012, '₹': 0.012,
  PKR: 0.0036,
  JPY: 0.0067, '¥': 0.0067,
  CHF: 1.12,
  SGD: 0.74,
  HKD: 0.13,
  SEK: 0.095,
  NOK: 0.093,
  DKK: 0.14,
  PLN: 0.25,
  CZK: 0.043,
  HUF: 0.0027,
  BRL: 0.20,
  MXN: 0.058,
  ZAR: 0.055,
  AED: 0.27,
  SAR: 0.27,
  KRW: 0.00074,
  TWD: 0.031,
  THB: 0.028,
  PHP: 0.017,
  MYR: 0.21,
  IDR: 0.000063,
  VND: 0.000039,
  TRY: 0.031,
  RUB: 0.011,
  UAH: 0.025,
  ARS: 0.0011,
  CLP: 0.0011,
  COP: 0.00025,
  PEN: 0.27
};

const LANGUAGE_MAP = {
  en: 'English', english: 'English',
  es: 'Spanish', spanish: 'Spanish', español: 'Spanish',
  fr: 'French', french: 'French', français: 'French',
  de: 'German', german: 'German', deutsch: 'German',
  pt: 'Portuguese', portuguese: 'Portuguese', português: 'Portuguese',
  it: 'Italian', italian: 'Italian', italiano: 'Italian',
  nl: 'Dutch', dutch: 'Dutch',
  ru: 'Russian', russian: 'Russian',
  zh: 'Chinese', chinese: 'Chinese',
  ja: 'Japanese', japanese: 'Japanese',
  ko: 'Korean', korean: 'Korean',
  ar: 'Arabic', arabic: 'Arabic',
  hi: 'Hindi', hindi: 'Hindi',
  tr: 'Turkish', turkish: 'Turkish',
  pl: 'Polish', polish: 'Polish',
  sv: 'Swedish', swedish: 'Swedish',
  da: 'Danish', danish: 'Danish',
  no: 'Norwegian', norwegian: 'Norwegian',
  fi: 'Finnish', finnish: 'Finnish',
  cs: 'Czech', czech: 'Czech',
  ro: 'Romanian', romanian: 'Romanian',
  hu: 'Hungarian', hungarian: 'Hungarian',
  el: 'Greek', greek: 'Greek',
  he: 'Hebrew', hebrew: 'Hebrew',
  th: 'Thai', thai: 'Thai',
  vi: 'Vietnamese', vietnamese: 'Vietnamese',
  id: 'Indonesian', indonesian: 'Indonesian',
  ms: 'Malay', malay: 'Malay',
  uk: 'Ukrainian', ukrainian: 'Ukrainian'
};

export function detectCurrency(text) {
  if (!text) return 'USD';
  const upper = text.toUpperCase();
  for (const [code] of Object.entries(CURRENCY_TO_USD)) {
    if (code.length >= 3 && upper.includes(code)) return code;
  }
  if (text.includes('€')) return 'EUR';
  if (text.includes('£')) return 'GBP';
  if (text.includes('₹')) return 'INR';
  if (text.includes('¥')) return 'JPY';
  if (text.includes('$')) return 'USD';
  return 'USD';
}

export function toUsd(amount, currency) {
  const rate = CURRENCY_TO_USD[currency] || CURRENCY_TO_USD[currency?.toUpperCase()] || 1;
  return amount * rate;
}

export function parseBudgetUsd(budgetText, bidType) {
  if (!budgetText) return { minUsd: 0, maxUsd: 0, isHourly: false };

  const isHourly = bidType === 'hourly' || /per hour|hourly|\/hr|\/hour/i.test(budgetText);
  const numbers = budgetText.match(/[\d,]+\.?\d*/g)?.map((n) => parseFloat(n.replace(/,/g, ''))) || [];
  if (!numbers.length) return { minUsd: 0, maxUsd: 0, isHourly };

  const currency = detectCurrency(budgetText);
  const minVal = Math.min(...numbers);
  const maxVal = Math.max(...numbers);
  const minUsd = toUsd(minVal, currency);
  const maxUsd = toUsd(maxVal, currency);

  if (isHourly) {
    const estimatedMinProjectUsd = minUsd * 40;
    return { minUsd: estimatedMinProjectUsd, maxUsd: maxUsd * 40, isHourly: true, hourlyMinUsd: minUsd };
  }

  return { minUsd, maxUsd, isHourly: false };
}

export function meetsMinPrice(budgetText, bidType, minUsd = 100) {
  const parsed = parseBudgetUsd(budgetText, bidType);
  return parsed.minUsd >= minUsd;
}

export function isExcludedCountry(countryText, excludedList) {
  if (!countryText) return false;
  const normalized = countryText.toLowerCase().trim();
  const list = excludedList || DEFAULT_EXCLUDED_COUNTRIES;
  return list.some((country) => {
    const c = country.toLowerCase();
    return normalized === c || normalized.includes(c) || c.includes(normalized);
  });
}

export function detectProjectLanguage(project) {
  const explicit =
    project.projectLanguage ||
    project.language ||
    project.adLanguage ||
    '';

  if (explicit) {
    const key = explicit.toLowerCase().trim();
    return LANGUAGE_MAP[key] || explicit;
  }

  const langEl = project.languageText || '';
  const langPatterns = [
    { pattern: /posted in\s+(\w+)/i, group: 1 },
    { pattern: /language[:\s]+(\w+)/i, group: 1 },
    { pattern: /(english|spanish|french|german|portuguese|italian|dutch|russian|chinese|japanese|korean|arabic|hindi|turkish|polish)/i, group: 1 }
  ];

  const searchText = `${langEl} ${project.title || ''} ${project.description || ''}`;
  for (const { pattern, group } of langPatterns) {
    const m = searchText.match(pattern);
    if (m) {
      const key = m[group].toLowerCase();
      return LANGUAGE_MAP[key] || m[group];
    }
  }

  const text = `${project.title || ''} ${project.description || ''}`;
  if (detectSpanish(text)) return 'Spanish';
  if (detectFrench(text)) return 'French';
  if (detectGerman(text)) return 'German';
  if (detectPortuguese(text)) return 'Portuguese';

  return 'English';
}

function detectSpanish(text) {
  return /\b(hola|necesito|busco|proyecto|desarrollo|sitio web|aplicación|gracias|presupuesto)\b/i.test(text);
}

function detectFrench(text) {
  return /\b(bonjour|besoin|projet|développement|site web|application|merci|budget)\b/i.test(text);
}

function detectGerman(text) {
  return /\b(hallo|brauche|projekt|entwicklung|webseite|anwendung|danke|budget)\b/i.test(text);
}

function detectPortuguese(text) {
  return /\b(olá|preciso|projeto|desenvolvimento|site|aplicação|obrigado|orçamento)\b/i.test(text);
}

export function getProjectSearchText(project) {
  return [
    project.title,
    project.description,
    (project.skills || []).join(' '),
    (project.categories || []).join(' ')
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function detectExcludedCategory(project, rules = EXCLUDED_CATEGORY_RULES) {
  const text = getProjectSearchText(project);

  for (const rule of rules) {
    for (const keyword of rule.keywords) {
      const normalized = keyword.toLowerCase().trim();
      if (!normalized) continue;

      if (normalized.includes(' ')) {
        if (text.includes(normalized)) return rule;
        continue;
      }

      const pattern = new RegExp(`\\b${escapeRegExp(normalized)}\\b`, 'i');
      if (pattern.test(text)) return rule;
    }
  }

  return null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isExcludedCategory(project, settings) {
  if (settings?.skipExcludedCategories === false) return null;
  const rules = settings?.excludedCategories || EXCLUDED_CATEGORY_RULES;
  return detectExcludedCategory(project, rules);
}

export function evaluateProjectFilters(project, settings) {
  const minPriceUsd = settings.minPriceUsd ?? 100;
  const excludedCountries = settings.excludedCountries || DEFAULT_EXCLUDED_COUNTRIES;

  const excludedCategory = isExcludedCategory(project, settings);
  if (excludedCategory) {
    return {
      pass: false,
      reason: `excluded_category_${excludedCategory.id}`,
      message: `除外カテゴリ: ${excludedCategory.label}`
    };
  }

  if (!meetsMinPrice(project.budget, project.bidType, minPriceUsd)) {
    const parsed = parseBudgetUsd(project.budget, project.bidType);
    return {
      pass: false,
      reason: `price_below_min_${parsed.minUsd.toFixed(0)}usd`,
      message: `価格が最低$${minPriceUsd}未満 (推定$${parsed.minUsd.toFixed(0)})`
    };
  }

  const clientCountry = project.clientCountry || project.country || '';
  if (isExcludedCountry(clientCountry, excludedCountries)) {
    return {
      pass: false,
      reason: `excluded_country_${clientCountry}`,
      message: `除外国: ${clientCountry}`
    };
  }

  return { pass: true };
}

export function getProposalLanguageInstruction(project) {
  const lang = detectProjectLanguage(project);
  if (lang === 'English') {
    return 'Write the proposal in English.';
  }
  return `Write the proposal in ${lang} (the language used by the client in the project advertisement). If uncertain, default to English.`;
}
