type Translate = (key: string, fallback: string, options?: Record<string, unknown>) => string;

const TOOL_NAME_ALIASES: Record<string, string> = {
  askuser: 'askuserquestion',
  askuserquestion: 'askuserquestion',
  requestuserinput: 'askuserquestion',
  bashoutput: 'bashoutput',
  commandoutput: 'commandoutput',
  enterplanmode: 'enterplanmode',
  enterworktree: 'enterworktree',
  exitplanmode: 'exitplanmode',
  findfiles: 'glob',
  listdirectory: 'ls',
  listfiles: 'glob',
  multiedit: 'multiedit',
  notebookedit: 'notebookedit',
  readfile: 'read',
  runshellcommand: 'bash',
  searchfilecontent: 'grep',
  searchfiles: 'grep',
  searchweb: 'websearch',
  shellcommand: 'bash',
  taskoutput: 'taskoutput',
  taskstop: 'taskstop',
  todoread: 'todoread',
  todowrite: 'todowrite',
  toolsearch: 'toolsearch',
  webfetch: 'webfetch',
  websearch: 'websearch',
  writefile: 'write',
};

const TOOL_NAME_FALLBACKS: Record<string, string> = {
  askuserquestion: 'Ask User',
  bash: 'Terminal',
  bashoutput: 'Terminal Output',
  command: 'Command',
  commandoutput: 'Command Output',
  edit: 'Edit',
  enterplanmode: 'Enter Plan Mode',
  enterworktree: 'Enter Worktree',
  exitplanmode: 'Exit Plan Mode',
  glob: 'Glob',
  grep: 'Grep',
  ls: 'List Directory',
  multiedit: 'MultiEdit',
  notebookedit: 'Notebook Edit',
  read: 'Read',
  skill: 'Skill',
  task: 'Task',
  taskoutput: 'Task Output',
  taskstop: 'Stop Task',
  todoread: 'Read Todos',
  todowrite: 'Update Todos',
  toolsearch: 'Tool Search',
  webfetch: 'Web Fetch',
  websearch: 'Web Search',
  write: 'Write',
};

export const normalizeToolDisplayNameKey = (toolName: string | undefined | null): string => {
  const normalized = (toolName ?? '')
    .trim()
    .replace(/[-_\s]/g, '')
    .toLowerCase();

  return TOOL_NAME_ALIASES[normalized] ?? normalized;
};

export const getLocalizedToolName = (
  toolName: string | undefined | null,
  t: Translate,
): string => {
  if (!toolName) return '';

  if (toolName.startsWith('mcp__')) {
    return toolName;
  }

  const key = normalizeToolDisplayNameKey(toolName);
  const fallback = TOOL_NAME_FALLBACKS[key] ?? toolName;
  return t(`tool.names.${key}`, fallback);
};

export const getLocalizedToolList = (
  toolNames: Array<string | undefined | null>,
  t: Translate,
): string => toolNames
  .map((toolName) => getLocalizedToolName(toolName, t))
  .filter(Boolean)
  .join('、');
