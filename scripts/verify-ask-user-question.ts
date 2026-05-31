import assert from 'node:assert/strict';
import { normalizeQuestions } from '../src/lib/askUserQuestionUtils.js';

const looseJsonQuestions = `[{"question":"外网实测不通（DDG 超时、维基/百度 403，只有 msuicode 网关可达），但 opus 自带史实知识很准（刚实测李承乾6条全对、带出处）。调研来源走哪条？","header":"调研来源","multiSelect":false,"options":[{"label":"模型内置史实(推荐)","description":"新增 research_agent 让 opus 把自带史实结构化产出。立即可用、零外部依赖、覆盖正史名场面。代价：冷僻细节可能不全"},{"label":"联网搜索","description":"接 DDG/维基搜索 API。但这台机器外网全不通，需先解决代理/网络才能落地"},{"label":"内置+联网兜底","description":"\\u4 ee5模型内置为主，架构预留可配置联网接口，等网络具备再启用。工作量最大"}]},{"question":"调研结果要注入哪些环节？（可多选）","header":"注入范围","multiSelect":true,"options":[{"label":"史实名场面库","description":"产出真实名场面清单（如'请陛下称太子'、称心起冢、自号可汗），注入 scene_designer/plot_weaver"},{"label":"人物史实档案","description":"每角色正史生平/结局/标志言行，注入 character_scribe，让 cast 有史可依"},{"label":"时代质感库","description":"服饰/器物/礼仪/官职/地名等细节，注入 voice_profiles 和正文 prompt"}]}]`;

const questions = normalizeQuestions(looseJsonQuestions);

assert.equal(questions.length, 2, 'loose JSON question array should still render as two questions');
assert.equal(questions[0]?.header, '调研来源', 'first question header should be preserved');
assert.equal(questions[0]?.options?.length, 3, 'first question options should be preserved');
assert.equal(questions[1]?.header, '注入范围', 'second question header should be preserved');
assert.equal(questions[1]?.multiSelect, true, 'multiSelect should be preserved');
assert.equal(questions[1]?.options?.length, 3, 'second question options should be preserved');
assert.match(
  questions[0]?.options?.[2]?.description || '',
  /以模型内置为主/,
  'split unicode escape should be repaired before parsing',
);

console.log('ask user question verification passed');
