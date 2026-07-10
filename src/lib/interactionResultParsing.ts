import type { UserAnswers } from '@/contexts/UserQuestionContext';
import { normalizeAnswers } from '@/lib/askUserQuestionUtils';

export type AskUserResultStatus = 'pending' | 'answered' | 'deferred' | 'expired';
export type PlanResultStatus = 'pending' | 'approved' | 'rejected' | 'deferred' | 'expired';

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeResultText = (text: string): string =>
  text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .trim();

/**
 * Extract human text from the common tool_result shapes:
 * - string
 * - MCP content arrays: [{ type: "text", text: "..." }]
 * - nested { content }, { text }, { message }, { output }, { result } objects
 */
export function extractInteractionResultText(value: unknown): string {
  if (typeof value === 'string') {
    return normalizeResultText(value);
  }

  if (value == null) {
    return '';
  }

  if (Array.isArray(value)) {
    return value
      .map(extractInteractionResultText)
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  if (!isRecord(value)) {
    return normalizeResultText(String(value));
  }

  for (const field of ['text', 'message', 'content', 'output', 'result', 'answer']) {
    if (field in value) {
      const extracted = extractInteractionResultText(value[field]);
      if (extracted) {
        return extracted;
      }
    }
  }

  return '';
}

function extractDirectAnswers(value: unknown): UserAnswers {
  if (isRecord(value)) {
    const direct = normalizeAnswers(value.answers);
    if (Object.keys(direct).length > 0) {
      return direct;
    }

    if ('content' in value) {
      const nested = extractDirectAnswers(value.content);
      if (Object.keys(nested).length > 0) {
        return nested;
      }
    }

    if ('result' in value) {
      const nested = extractDirectAnswers(value.result);
      if (Object.keys(nested).length > 0) {
        return nested;
      }
    }
  }

  return {};
}

function parseJsonAnswersFromText(text: string): UserAnswers {
  const trimmed = text.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed);
    return extractDirectAnswers(parsed);
  } catch {
    return {};
  }
}

function parseCanonicalQuestionAnswerText(text: string): UserAnswers {
  const answers: UserAnswers = {};
  const regex = /(?:^|\n)\s*(?:问题|Question)\s*[:：]\s*([\s\S]*?)\s*\n\s*(?:回答|Answer)\s*[:：]\s*([\s\S]*?)(?=\n\s*(?:问题|Question)\s*[:：]|\s*$)/gi;

  for (const match of text.matchAll(regex)) {
    const question = match[1]?.trim();
    const answer = match[2]?.trim();
    if (question && answer) {
      answers[question] = answer;
    }
  }

  return answers;
}

function parseQuotedQuestionAnswerText(text: string): UserAnswers {
  const answers: UserAnswers = {};
  const regex = /"([^"]+)"\s*=\s*"([^"]*)"/g;

  for (const match of text.matchAll(regex)) {
    const question = match[1]?.trim();
    const answer = match[2]?.trim();
    if (question && answer) {
      answers[question] = answer;
    }
  }

  return answers;
}

export function parseAskUserAnswersFromResultContent(value: unknown): UserAnswers {
  const direct = extractDirectAnswers(value);
  if (Object.keys(direct).length > 0) {
    return direct;
  }

  const text = extractInteractionResultText(value);
  if (!text) {
    return {};
  }

  for (const parser of [
    parseJsonAnswersFromText,
    parseCanonicalQuestionAnswerText,
    parseQuotedQuestionAnswerText,
  ]) {
    const parsed = parser(text);
    if (Object.keys(parsed).length > 0) {
      return parsed;
    }
  }

  return {};
}

const ASK_DEFER_PATTERNS = [
  /暂时没想好/,
  /暂时不回答/,
  /暂不回答/,
  /不要替用户选择/,
  /暂停等待用户后续说明/,
  /\bdefer(?:red)?\b/i,
  /\bnot\s+answer\b/i,
];

const PLAN_DEFER_PATTERNS = [
  /暂时未决定/,
  /暂不决定/,
  /先别执行/,
  /请不要执行计划/,
  /先暂停/,
  /等待用户后续确认/,
  /\bdefer(?:red)?\b/i,
  /\bno\s+decision\b/i,
];

const PLAN_REJECT_PATTERNS = [
  /【拒绝】/,
  /已拒绝/,
  /拒绝了该计划/,
  /继续规划/,
  /\breject(?:ed)?\b/i,
];

const PLAN_APPROVE_PATTERNS = [
  /【批准】/,
  /已批准/,
  /批准执行/,
  /开始执行上述计划/,
  /\bapprove(?:d)?\b/i,
];

const INTERACTION_EXPIRED_PATTERNS = [
  /等待用户回答超时/,
  /用户回答超时/,
  /请求超时/,
  /已超时/,
  /超时/,
  /已过期/,
  /过期/,
  /提问通道已关闭/,
  /通道已关闭/,
  /未能收集到回答/,
  /\bexpired\b/i,
  /\btimed\s*out\b/i,
  /\btimeout\b/i,
  /\bno\s+pending\s+request\b/i,
  /\bpending\s+request\s+(?:not\s+found|missing)\b/i,
  /\binteraction\s+(?:not\s+found|expired)\b/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function resolveAskUserResultStatus(value: unknown, isError?: boolean): AskUserResultStatus {
  if (value == null) {
    return 'pending';
  }

  const answers = parseAskUserAnswersFromResultContent(value);
  if (Object.keys(answers).length > 0) {
    return 'answered';
  }

  const text = extractInteractionResultText(value);
  if (!text) {
    return 'pending';
  }

  if (matchesAny(text, ASK_DEFER_PATTERNS)) {
    return 'deferred';
  }

  if (matchesAny(text, INTERACTION_EXPIRED_PATTERNS)) {
    return 'expired';
  }

  if (isError) {
    return 'pending';
  }

  return 'answered';
}

export function resolvePlanResultStatus(value: unknown, isError?: boolean): PlanResultStatus {
  if (value == null) {
    return 'pending';
  }

  const text = extractInteractionResultText(value);
  if (!text) {
    return 'pending';
  }

  if (matchesAny(text, INTERACTION_EXPIRED_PATTERNS)) {
    return 'expired';
  }

  // Must run before approve matching: the defer sentence intentionally contains
  // "是否批准", which is not approval.
  if (matchesAny(text, PLAN_DEFER_PATTERNS)) {
    return 'deferred';
  }

  if (matchesAny(text, PLAN_REJECT_PATTERNS)) {
    return 'rejected';
  }

  if (matchesAny(text, PLAN_APPROVE_PATTERNS)) {
    return 'approved';
  }

  if (isError) {
    return 'pending';
  }

  return 'pending';
}
