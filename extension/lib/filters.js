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

const LANG_NAME_TO_CODE = {
  English: 'en',
  Spanish: 'es',
  Portuguese: 'pt',
  Chinese: 'zh',
  French: 'fr',
  German: 'de',
  Italian: 'it',
  Dutch: 'nl',
  Russian: 'ru',
  Japanese: 'ja',
  Korean: 'ko',
  Arabic: 'ar',
  Hindi: 'hi',
  Turkish: 'tr',
  Polish: 'pl'
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

const COUNTRY_ALIASES = {
  in: 'india',
  ind: 'india',
  pk: 'pakistan',
  ng: 'nigeria',
  za: 'south africa',
  eg: 'egypt',
  ke: 'kenya',
  bd: 'bangladesh',
  'ivory coast': "cote d'ivoire",
  'côte d\'ivoire': "cote d'ivoire"
};

export function normalizeCountryText(countryText) {
  if (!countryText) return '';
  return countryText.toLowerCase().trim().replace(/\s+/g, ' ');
}

export function isExcludedCountry(countryText, excludedList) {
  if (!countryText) return false;
  const normalized = normalizeCountryText(countryText);
  const alias = COUNTRY_ALIASES[normalized] || normalized;
  const list = excludedList || DEFAULT_EXCLUDED_COUNTRIES;
  return list.some((country) => {
    const c = normalizeCountryText(country);
    const cAlias = COUNTRY_ALIASES[c] || c;
    return (
      normalized === c ||
      alias === c ||
      normalized === cAlias ||
      normalized.includes(c) ||
      c.includes(normalized) ||
      alias.includes(c) ||
      c.includes(alias)
    );
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

/** Title + opening description only — skills/tags often mention marketing tangentially */
export function getCategoryAnalysisText(project) {
  const title = (project.title || '').trim();
  const desc = (project.description || '').trim().slice(0, 600);
  return { title: title.toLowerCase(), text: `${title}\n${desc}`.toLowerCase(), titleRaw: title };
}

const MARKETING_PRIMARY_PATTERNS = [
  /\b(?:social\s+media|digital|email|content|influencer|affiliate)\s+marketing\b/i,
  /\bmarketing\s+(?:manager|specialist|expert|consultant|campaign|strategy)\b/i,
  /\b(?:facebook|google|instagram|tiktok)\s+ads?\b/i,
  /\b(?:ppc|smm|seo)\s+(?:campaign|specialist|manager|expert)\b/i,
  /\blead\s+generation\s+(?:campaign|specialist|manager)\b/i,
  /\b(?:brand\s+awareness|media\s+buying|growth\s+hacking)\s+(?:campaign|strategy)\b/i,
  /\b(?:promotion|advertising)\s+campaign\b/i,
  /\bマーケティング(?:担当|専門|施策|運用)\b/i
];

const VA_RECRUITMENT_PATTERNS = [
  /\b(?:need|looking\s+for|hire|hiring|seeking|want)\s+(?:an?\s+)?virtual\s+assistant\b/i,
  /\bvirtual\s+assistant\s+(?:needed|wanted|required|position|job)\b/i,
  /\b(?:need|looking\s+for|hire|hiring)\s+(?:an?\s+)?(?:personal|executive|administrative|online|remote)\s+assistant\b/i,
  /\bva\s+(?:needed|wanted|required|position)\b/i,
  /\b仮想秘書|バーチャルアシスタント|オンライン秘書|リモート秘書/i
];

const ADULT_PRIMARY_PATTERNS = [
  /\badult\s+(?:content|website|site|video|entertainment|chat)\b/i,
  /\b(?:porn|pornograph|xxx|nsfw|onlyfans|webcam\s+model|cam\s+girl|cam\s+site)\b/i,
  /\b(?:erotic|escort|nude|nudity|sex\s+site|sex\s+chat|18\+|x-?rated)\b/i,
  /\b成人(?:向け|コンテンツ|サイト)?|アダルト|エロ|風俗/i
];

function matchesAnyPattern(text, patterns) {
  return patterns.some((p) => p.test(text));
}

function isMarketingPrimaryProject(title, text) {
  if (matchesAnyPattern(title, MARKETING_PRIMARY_PATTERNS)) return true;
  const opening = text.slice(0, 350);
  if (matchesAnyPattern(opening, MARKETING_PRIMARY_PATTERNS)) return true;
  if (/\b(?:i\s+need|we\s+need|looking\s+for)\s+.*\bmarketing\b/i.test(opening)) return true;
  if (/\bsocial\s+media\b/i.test(title) && /\b(?:lead\s+gen|marketing|campaign|management|posts|ads)\b/i.test(title)) {
    return true;
  }
  if (/\b(?:seo|ppc|google\s+ads|facebook\s+ads)\b/i.test(title) && /\b(?:traffic|ranking|campaign|specialist)\b/i.test(title)) {
    return true;
  }
  return false;
}

function isVaRecruitmentProject(title, text) {
  if (matchesAnyPattern(title, VA_RECRUITMENT_PATTERNS)) return true;
  const opening = text.slice(0, 400);
  return matchesAnyPattern(opening, VA_RECRUITMENT_PATTERNS);
}

function isAdultContentProject(title, text) {
  if (matchesAnyPattern(title, ADULT_PRIMARY_PATTERNS)) return true;
  return matchesAnyPattern(text.slice(0, 400), ADULT_PRIMARY_PATTERNS);
}

export function analyzeProjectRequirements(project) {
  const { title, text, titleRaw } = getCategoryAnalysisText(project);
  const analysis = {
    title: titleRaw,
    primaryType: 'general',
    excludedCategory: null,
    summary: ''
  };

  if (isAdultContentProject(title, text)) {
    analysis.primaryType = 'adult';
    analysis.excludedCategory = EXCLUDED_CATEGORY_RULES.find((r) => r.id === 'adult');
    analysis.summary = 'Primary requirement: adult content project';
    return analysis;
  }
  if (isVaRecruitmentProject(title, text)) {
    analysis.primaryType = 'virtual_assistant';
    analysis.excludedCategory = EXCLUDED_CATEGORY_RULES.find((r) => r.id === 'virtual_assistant');
    analysis.summary = 'Primary requirement: virtual assistant recruitment';
    return analysis;
  }
  if (isMarketingPrimaryProject(title, text)) {
    analysis.primaryType = 'marketing';
    analysis.excludedCategory = EXCLUDED_CATEGORY_RULES.find((r) => r.id === 'marketing');
    analysis.summary = 'Primary requirement: marketing-focused project';
    return analysis;
  }

  if (/\b(?:develop|build|create|design|implement|fix|migrate|integrate)\b/i.test(text)) {
    analysis.primaryType = 'development';
    analysis.summary = 'Primary requirement: development/technical work';
  } else if (/\b(?:write|content|article|blog|copy)\b/i.test(text)) {
    analysis.primaryType = 'content';
    analysis.summary = 'Primary requirement: content/writing work';
  } else {
    analysis.summary = 'Primary requirement: general freelance work';
  }
  return analysis;
}

export function detectExcludedCategory(project, rules = EXCLUDED_CATEGORY_RULES) {
  const analysis = analyzeProjectRequirements(project);
  if (!analysis.excludedCategory) return null;
  const rule = rules.find((r) => r.id === analysis.excludedCategory.id);
  return rule || analysis.excludedCategory;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isExcludedCategory(project, settings) {
  if (settings?.skipExcludedCategories === false) return null;
  const rules = settings?.excludedCategories || EXCLUDED_CATEGORY_RULES;
  return detectExcludedCategory(project, rules);
}

export function evaluateLanguageFilter(project, settings) {
  const allowed = settings.languages || [];
  if (!allowed.length) return { pass: true };

  const langName = detectProjectLanguage(project);
  const code =
    LANG_NAME_TO_CODE[langName] ||
    langName.toLowerCase().slice(0, 2) ||
    project.projectLanguage ||
    project.language ||
    '';

  const normalized = String(code).toLowerCase();
  const ok = allowed.some(
    (a) => a.toLowerCase() === normalized || a.toLowerCase() === langName.toLowerCase()
  );

  if (!ok) {
    return {
      pass: false,
      reason: `excluded_language_${normalized}`,
      message: `言語が対象外: ${langName} (${normalized})`
    };
  }
  return { pass: true };
}

export function evaluateProjectFilters(project, settings) {
  const minPriceUsd = settings.minPriceUsd ?? 100;
  const maxBudgetUsd = settings.maxBudget ?? 0;
  const excludedCountries = settings.excludedCountries || DEFAULT_EXCLUDED_COUNTRIES;
  const allowedTypes = settings.projectTypes || ['fixed', 'hourly'];
  const bidType = project.bidType || 'fixed';

  const languageFilter = evaluateLanguageFilter(project, settings);
  if (!languageFilter.pass) {
    return languageFilter;
  }

  if (allowedTypes.length && !allowedTypes.includes(bidType)) {
    return {
      pass: false,
      reason: `excluded_type_${bidType}`,
      message: `プロジェクト種別が対象外: ${bidType}`
    };
  }

  const requirementAnalysis = analyzeProjectRequirements(project);

  const excludedCategory = isExcludedCategory(project, settings);
  if (excludedCategory) {
    return {
      pass: false,
      reason: `excluded_category_${excludedCategory.id}`,
      message: `除外カテゴリ: ${excludedCategory.label} — ${requirementAnalysis.summary}`,
      requirementAnalysis
    };
  }

  const parsed = parseBudgetUsd(project.budget, bidType);
  const effectiveMinUsd = Math.max(parsed.minUsd, project.budgetMinUsd || 0);

  if (effectiveMinUsd > 0 && effectiveMinUsd < minPriceUsd) {
    return {
      pass: false,
      reason: `price_below_min_${effectiveMinUsd.toFixed(0)}usd`,
      message: `価格が最低$${minPriceUsd}未満 (推定$${effectiveMinUsd.toFixed(0)})`,
      requirementAnalysis
    };
  }

  if (maxBudgetUsd > 0 && parsed.maxUsd > maxBudgetUsd) {
    return {
      pass: false,
      reason: `price_above_max_${parsed.maxUsd.toFixed(0)}usd`,
      message: `価格が上限$${maxBudgetUsd}超過 (推定$${parsed.maxUsd.toFixed(0)})`
    };
  }

  const clientCountry = project.clientCountry || project.country || '';
  if (clientCountry && isExcludedCountry(clientCountry, excludedCountries)) {
    return {
      pass: false,
      reason: `excluded_country_${clientCountry}`,
      message: `除外国: ${clientCountry}`,
      requirementAnalysis
    };
  }

  const requireKnownCountry = settings.skipUnknownCountry !== false;
  if (requireKnownCountry && excludedCountries.length > 0 && !clientCountry) {
    return {
      pass: false,
      reason: 'country_unknown',
      message: 'クライアント国が不明のためスキップ（除外国設定あり）',
      requirementAnalysis
    };
  }

  return { pass: true, requirementAnalysis };
}

export function evaluateExecutionDeadline(project, settings) {
  const graceSec = settings.bidExecutionGraceSec ?? 180;
  const deadline = project.bidDeadlineAt || project.eligibleUntil;
  if (!deadline) return { pass: true };
  if (Date.now() > deadline) {
    return {
      pass: false,
      reason: 'execution_timeout',
      message: `入札実行期限超過 (${graceSec}秒)`
    };
  }
  return { pass: true };
}

export function getProjectAgeSeconds(project) {
  if (project.detectedAt) {
    const elapsed = Math.floor((Date.now() - project.detectedAt) / 1000);
    if (project.secondsAgo != null && project.secondsAgo >= 0) {
      return Math.max(elapsed, project.secondsAgo);
    }
    return elapsed;
  }
  if (project.secondsAgo != null && project.secondsAgo >= 0) {
    return project.secondsAgo;
  }
  return null;
}

export function evaluateAgeWindow(project, settings) {
  const minAge = settings.bidWindowMinSec ?? 3;
  const maxAge = settings.bidWindowMaxSec ?? 120;
  const ageSec = getProjectAgeSeconds(project);

  if (ageSec == null) {
    if (project.isListedOld) {
      return {
        pass: false,
        reason: 'listing_not_new',
        message: '掲載期間のみ表示（新規投稿ではない）',
        defer: false
      };
    }

    if (project.isNewDetection && project.detectedAt) {
      const detectedAge = Math.floor((Date.now() - project.detectedAt) / 1000);
      if (detectedAge < minAge) {
        return {
          pass: false,
          reason: `too_young_${detectedAge}s`,
          message: `検出から${minAge}秒未満 (${detectedAge}秒)`,
          defer: true,
          retryInMs: Math.max(200, (minAge - detectedAge) * 1000 + 300)
        };
      }
      if (detectedAge > maxAge) {
        return {
          pass: false,
          reason: `too_old_${detectedAge}s`,
          message: `検出から${maxAge}秒超過 (${detectedAge}秒)`,
          defer: false
        };
      }
      return { pass: true, ageSec: detectedAge, usedDetectionTime: true };
    }

    return { pass: false, reason: 'age_unknown', message: '投稿時刻を判定できません', defer: false };
  }
  if (ageSec < minAge) {
    return {
      pass: false,
      reason: `too_young_${ageSec}s`,
      message: `投稿から${minAge}秒未満 (${ageSec}秒)`,
      defer: true,
      retryInMs: Math.max(200, (minAge - ageSec) * 1000 + 300)
    };
  }
  if (ageSec > maxAge) {
    return {
      pass: false,
      reason: `too_old_${ageSec}s`,
      message: `投稿から${maxAge}秒超過 (${ageSec}秒)`,
      defer: false
    };
  }
  return { pass: true, ageSec };
}

export function getProposalLanguageInstruction(project) {
  const lang = detectProjectLanguage(project);
  return `You MUST write the entire proposal in ${lang}. This is the language the client used in their project advertisement. Do not use any other language.`;
}
