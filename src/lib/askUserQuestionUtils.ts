import type { Question, UserAnswers } from "@/contexts/UserQuestionContext";

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function toDisplayString(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  return fallback;
}

export function normalizeAnswerValue(value: unknown): string | string[] | undefined {
  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => toDisplayString(item))
      .filter(Boolean);
    return normalized.length > 0 ? normalized : undefined;
  }

  const normalized = toDisplayString(value);
  return normalized || undefined;
}

export function normalizeAnswers(value: unknown): UserAnswers {
  if (!isRecord(value)) {
    return {};
  }

  return Object.entries(value).reduce<UserAnswers>((acc, [key, answer]) => {
    const normalized = normalizeAnswerValue(answer);
    if (normalized !== undefined) {
      acc[key] = normalized;
    }
    return acc;
  }, {});
}

export function normalizeQuestions(value: unknown): Question[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((rawQuestion, questionIndex) => {
    const record = isRecord(rawQuestion) ? rawQuestion : {};
    const question = toDisplayString(
      record.question,
      toDisplayString(record.header, `问题 ${questionIndex + 1}`)
    );
    const header = toDisplayString(record.header);
    const rawOptions = Array.isArray(record.options) ? record.options : [];

    const options = rawOptions.map((rawOption, optionIndex) => {
      const optionRecord = isRecord(rawOption) ? rawOption : {};
      return {
        label: toDisplayString(optionRecord.label, `选项 ${optionIndex + 1}`),
        description: toDisplayString(optionRecord.description) || undefined,
      };
    });

    return {
      question,
      header: header || undefined,
      options,
      multiSelect: record.multiSelect === true,
    };
  });
}

export function getQuestionKey(question: Pick<Question, "question" | "header">): string {
  return question.header || question.question;
}

export function getQuestionIdContent(questions: unknown): string {
  return normalizeQuestions(questions)
    .map((question) => question.question)
    .join("|");
}

export function isOptionSelectedSafe(
  optionLabel: unknown,
  answer: string | string[] | undefined
): boolean {
  const label = toDisplayString(optionLabel).toLowerCase();
  if (!label || !answer) return false;

  if (Array.isArray(answer)) {
    return answer.some((item) => {
      const normalized = toDisplayString(item).toLowerCase();
      return normalized.length > 0 && (label.includes(normalized) || normalized.includes(label));
    });
  }

  const normalizedAnswer = toDisplayString(answer).toLowerCase();
  return (
    normalizedAnswer.length > 0 &&
    (label.includes(normalizedAnswer) || normalizedAnswer.includes(label))
  );
}
