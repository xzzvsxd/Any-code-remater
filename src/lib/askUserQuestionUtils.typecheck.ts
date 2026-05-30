import { normalizeQuestions } from './askUserQuestionUtils';

export {};

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
};

const stringQuestion = normalizeQuestions('你希望我继续执行还是先解释计划？');
expectEqual(stringQuestion.length, 1, 'string questions become one question');
expectEqual(stringQuestion[0]?.question, '你希望我继续执行还是先解释计划？', 'string question text preserved');

const jsonQuestion = normalizeQuestions('[{"question":"选择环境？","options":["Windows","Linux"]}]');
expectEqual(jsonQuestion.length, 1, 'json string questions parsed');
expectEqual(jsonQuestion[0]?.options?.[0]?.label, 'Windows', 'string option label preserved');

const objectQuestion = normalizeQuestions({ question: '是否继续？', options: [{ label: '继续' }] });
expectEqual(objectQuestion.length, 1, 'single object question normalized');
expectEqual(objectQuestion[0]?.options?.[0]?.label, '继续', 'object option label preserved');

const missingQuestionFields = normalizeQuestions([
  { header: '环境', options: ['Windows', 'Linux'] },
  { options: [{ label: '继续' }] },
]);
expectEqual(missingQuestionFields.length, 2, 'array items without question are preserved');
expectEqual(missingQuestionFields[0]?.question, '环境', 'header falls back to question text');
expectEqual(missingQuestionFields[1]?.question, '问题 2', 'missing question falls back to numbered label');
expectEqual(missingQuestionFields[1]?.options?.[0]?.label, '继续', 'options survive missing question fallback');
