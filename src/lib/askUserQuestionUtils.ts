import type { Question, QuestionOption, UserAnswers } from "@/contexts/UserQuestionContext";

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

function parseQuestionJsonString(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("[") && !trimmed.startsWith("{"))) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function normalizeOptions(value: unknown): Question["options"] {
  if (Array.isArray(value)) {
    return value.map((rawOption, optionIndex) => {
      if (!isRecord(rawOption)) {
        return {
          label: toDisplayString(rawOption, `选项 ${optionIndex + 1}`),
          description: undefined,
        };
      }

      return {
        label: toDisplayString(
          rawOption.label,
          toDisplayString(
            rawOption.text,
            toDisplayString(
              rawOption.value,
              toDisplayString(rawOption.id, `选项 ${optionIndex + 1}`)
            )
          )
        ),
        description: toDisplayString(rawOption.description) || undefined,
      };
    });
  }

  const singleOption = toDisplayString(value);
  return singleOption ? [{ label: singleOption, description: undefined }] : [];
}

function normalizeQuestion(rawQuestion: unknown, questionIndex: number): Question {
  if (!isRecord(rawQuestion)) {
    return {
      question: toDisplayString(rawQuestion, `问题 ${questionIndex + 1}`),
      options: [],
      multiSelect: false,
    };
  }

  const question = toDisplayString(
    rawQuestion.question,
    toDisplayString(
      rawQuestion.text,
      toDisplayString(
        rawQuestion.content,
        toDisplayString(
          rawQuestion.prompt,
          toDisplayString(rawQuestion.header, `问题 ${questionIndex + 1}`)
        )
      )
    )
  );
  const header = toDisplayString(rawQuestion.header, toDisplayString(rawQuestion.title));
  const options = normalizeOptions(rawQuestion.options ?? rawQuestion.choices);

  return {
    question,
    header: header || undefined,
    options,
    multiSelect: rawQuestion.multiSelect === true
      || rawQuestion.multi_select === true
      || rawQuestion.multiple === true,
  };
}

export function normalizeQuestions(value: unknown): Question[] {
  if (typeof value === "string") {
    const parsed = parseQuestionJsonString(value);
    if (parsed !== null) {
      const normalized = normalizeQuestions(parsed);
      if (normalized.length > 0) {
        return normalized;
      }
    }

    const question = toDisplayString(value);
    return question ? [normalizeQuestion(question, 0)] : [];
  }

  if (isRecord(value)) {
    if ("questions" in value) {
      const normalized = normalizeQuestions(value.questions);
      if (normalized.length > 0) {
        return normalized;
      }
    }

    return [normalizeQuestion(value, 0)];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeQuestion).filter(question => question.question.length > 0);
}

export function getQuestionKey(question: Pick<Question, "question" | "header">): string {
  return question.header || question.question;
}

export function getQuestionIdContent(questions: unknown): string {
  return JSON.stringify(normalizeQuestions(questions).map((question) => ({
    question: question.question,
    header: question.header || "",
    multiSelect: question.multiSelect === true,
    options: (question.options || []).map((option) => ({
      label: option.label,
      description: option.description || "",
    })),
  })));
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

function splitAnswerListText(answer: string, optionLabels: string[]): string[] {
  const normalizedAnswer = toDisplayString(answer);
  if (!normalizedAnswer) {
    return [];
  }

  const parts = normalizedAnswer
    .split(/[、\n]+/)
    .map(part => part.trim())
    .filter(Boolean);

  if (
    parts.length > 1 &&
    parts.some(part => optionLabels.some(label => isOptionSelectedSafe(label, part)))
  ) {
    return parts;
  }

  return [normalizedAnswer];
}

export function getUnmatchedAnswerParts(
  answer: string | string[] | undefined,
  options: Array<Pick<QuestionOption, "label">> = [],
): string[] {
  if (!answer) {
    return [];
  }

  const optionLabels = options
    .map(option => toDisplayString(option.label))
    .filter(Boolean);

  const answerParts = Array.isArray(answer)
    ? answer.map(part => toDisplayString(part)).filter(Boolean)
    : splitAnswerListText(answer, optionLabels);

  return answerParts.filter(part =>
    !optionLabels.some(label => isOptionSelectedSafe(label, part))
  );
}
