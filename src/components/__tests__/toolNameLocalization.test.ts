import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

const zh = JSON.parse(readSource('src/i18n/locales/zh.json'));
const zhTW = JSON.parse(readSource('src/i18n/locales/zh-TW.json'));
const en = JSON.parse(readSource('src/i18n/locales/en.json'));

describe('tool name localization', () => {
  test('Chinese locales include display names for Claude Code tool identifiers', () => {
    const expectedZhNames = {
      task: '任务',
      taskoutput: '任务输出',
      taskstop: '停止任务',
      taskcreate: '创建任务',
      taskupdate: '更新任务',
      tasklist: '任务列表',
      taskget: '查看任务',
      bash: '终端',
      bashoutput: '终端输出',
      glob: '文件匹配',
      grep: '内容搜索',
      exitplanmode: '退出计划模式',
      read: '读取',
      edit: '编辑',
      multiedit: '批量编辑',
      write: '写入',
      notebookedit: '编辑笔记本',
      webfetch: '获取网页',
      todowrite: '更新待办',
      websearch: '网络搜索',
      askuserquestion: '询问用户',
      skill: '技能',
      enterplanmode: '进入计划模式',
      enterworktree: '进入工作树',
      toolsearch: '工具搜索',
    };

    for (const [key, value] of Object.entries(expectedZhNames)) {
      expect(zh.tool.names[key]).toBe(value);
      expect(zhTW.tool.names[key]).toBeTruthy();
      expect(en.tool.names[key]).toBeTruthy();
    }
  });

  test('tool call chrome renders localized names instead of raw tool identifiers', () => {
    const toolCallsGroup = readSource('src/components/message/ToolCallsGroup.tsx');
    const toolsList = readSource('src/components/widgets/system/components/ToolsList.tsx');

    expect(toolCallsGroup).toContain('getLocalizedToolName');
    expect(toolCallsGroup).not.toContain('{tool.name}</span>');
    expect(toolsList).toContain('getLocalizedToolName');
    expect(toolsList).toContain('{getLocalizedToolName(tool, t)}');
  });

  test('dedicated widgets do not hard-code English tool titles in visible UI', () => {
    const editWidget = readSource('src/components/widgets/file-operations/EditWidget.tsx');
    const grepWidget = readSource('src/components/widgets/search/GrepWidget.tsx');
    const globWidget = readSource('src/components/widgets/search/GlobWidget.tsx');
    const bashOutputWidget = readSource('src/components/widgets/execution/BashOutputWidget.tsx');
    const multiEditWidget = readSource('src/components/widgets/agent/MultiEditWidget.tsx');
    const planModeStatusBar = readSource('src/components/widgets/system/PlanModeStatusBar.tsx');

    expect(editWidget).not.toContain('>Edit</span>');
    expect(grepWidget).not.toContain('>Grep</span>');
    expect(globWidget).not.toContain('>Glob</span>');
    expect(bashOutputWidget).not.toContain('>Bash Output</span>');
    expect(multiEditWidget).not.toContain('使用工具： MultiEdit');
    expect(planModeStatusBar).not.toContain('允许使用：Read, Grep, Glob, WebFetch, WebSearch');
  });
});
