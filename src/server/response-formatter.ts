import type { SupportedTool, ChatMessage } from './client-registry';

export type FormatContext = {
  tool: SupportedTool;
  userInput: string;
  designContext?: string;
  originalContent: string;
  history: ChatMessage[];
};

export type ImprovementEntry = {
  point: string;
  rationale?: string;
};

export type FormattedResponse = {
  text: string;
  summary: string[];
  improvements: ImprovementEntry[];
  nextActions: string[];
  designContextNote?: string;
};

export interface ChatResponseFormatter {
  format(context: FormatContext): FormattedResponse;
}

type Sentence = {
  value: string;
  index: number;
};

const DISPLAY_VERSION = 'structured-response.v1';

const normalizeWhitespace = (input: string) => input.replace(/[\t\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

const stripMarkdown = (input: string) =>
  input
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^#+\s*/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]\([^)]*\)/g, '$1');

const normalize = (input: string) => normalizeWhitespace(stripMarkdown(input).replace(/\u3000/g, ' '));

const splitSentences = (input: string): Sentence[] => {
  if (!input) {
    return [];
  }

  const normalized = input
    .replace(/([。！？!?])(\s|$)/g, '$1|')
    .replace(/([\.\?!])(\s|$)/g, '$1|');

  return normalized
    .split('|')
    .map((value, index) => ({ value: value.trim(), index }))
    .filter((sentence) => sentence.value.length > 0);
};

const extractBullets = (input: string): Sentence[] => {
  return input
    .split(/\n+/)
    .map((line) => line.trim())
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^(?:[-*•・]|\d+\.|\d+\))/u.test(line))
    .map(({ line, index }) => ({ value: line.replace(/^(?:[-*•・]|\d+\.|\d+\))\s*/, '').trim(), index }))
    .filter((sentence) => sentence.value.length > 0);
};

const dedupe = (items: Sentence[]): Sentence[] => {
  const seen = new Set<string>();
  const result: Sentence[] = [];

  for (const item of items) {
    const key = item.value;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }

  return result;
};

const prioritize = (sentences: Sentence[], keywords: RegExp[]): Sentence[] => {
  if (sentences.length === 0) {
    return [];
  }
  const scored = sentences.map((sentence) => {
    const score = keywords.reduce((acc, keyword) => (keyword.test(sentence.value) ? acc + 1 : acc), 0);
    return { sentence, score };
  });

  return scored
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.sentence.index - b.sentence.index;
    })
    .map(({ sentence }) => sentence);
};

const buildSummary = (sentences: Sentence[], bullets: Sentence[]): string[] => {
  const candidates = dedupe([...bullets, ...sentences]);
  const selected = candidates.slice(0, 3).map((item) => item.value);

  if (selected.length > 0) {
    return selected;
  }

  return ['AI からの回答を要約できませんでした。原文をご確認ください。'];
};

const buildImprovements = (sentences: Sentence[]): ImprovementEntry[] => {
  const prioritized = prioritize(sentences, [/(?:改善|見直|修正|調整|最適化|should|recommend|suggest)/i]);
  const entries: ImprovementEntry[] = [];

  for (const sentence of prioritized) {
    const rationaleCandidate = sentences.find((item) => item.index === sentence.index + 1);
    const rationale = rationaleCandidate?.value && rationaleCandidate.value.length <= 140 ? rationaleCandidate.value : undefined;
    entries.push({ point: sentence.value, rationale });
    if (entries.length >= 3) {
      break;
    }
  }

  if (entries.length > 0) {
    return entries;
  }

  return [
    {
      point: '特に明確な改善提案は検出できませんでした。',
      rationale: '必要に応じて AI の原文回答を参照してください。',
    },
  ];
};

const buildNextActions = (sentences: Sentence[], userInput: string): string[] => {
  const prioritized = prioritize(sentences, [/(?:次|action|進め|試す|着手|follow\s*up|implement|進行|確認)/i]);
  const selected = prioritized.slice(0, 3).map((item) => item.value);

  if (selected.length > 0) {
    return selected;
  }

  return [`${userInput.trim()} に基づいて次のアクションを検討してください。`];
};

const createDesignContextNote = (designContext?: string): string | undefined => {
  if (!designContext) {
    return undefined;
  }

  const normalized = normalizeWhitespace(designContext);
  if (!normalized) {
    return undefined;
  }

  const maxLength = 120;
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}…`;
};

const composeSections = (
  summary: string[],
  improvements: ImprovementEntry[],
  nextActions: string[],
  designContextNote?: string,
) => {
  const lines: string[] = [];

  if (designContextNote) {
    lines.push(`🎯 デザイン文脈: ${designContextNote}`);
    lines.push('');
  }

  lines.push('✅ 要約');
  for (const entry of summary) {
    lines.push(`- ${entry}`);
  }
  lines.push('');

  lines.push('🛠 改善ポイント');
  improvements.forEach((entry, index) => {
    lines.push(`${index + 1}. ${entry.point}`);
    if (entry.rationale) {
      lines.push(`   └ 根拠: ${entry.rationale}`);
    }
  });
  lines.push('');

  lines.push('🚀 次の一歩');
  for (const action of nextActions) {
    lines.push(`- ${action}`);
  }

  return lines.join('\n');
};

export class StructuredResponseFormatter implements ChatResponseFormatter {
  format(context: FormatContext): FormattedResponse {
    const normalized = normalize(context.originalContent);
    const sentences = splitSentences(normalized);
    const bullets = extractBullets(context.originalContent);

    const summary = buildSummary(sentences, bullets);
    const improvements = buildImprovements(sentences);
    const nextActions = buildNextActions(sentences, context.userInput);
    const designContextNote = createDesignContextNote(context.designContext);

    const text = composeSections(summary, improvements, nextActions, designContextNote);

    return {
      text,
      summary,
      improvements,
      nextActions,
      designContextNote,
    };
  }
}

export const createDefaultFormatter = (): ChatResponseFormatter => new StructuredResponseFormatter();

export const formatterDisplayVersion = DISPLAY_VERSION;
