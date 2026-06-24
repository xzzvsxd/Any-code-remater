import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectContextSource = readFileSync(
  resolve(process.cwd(), 'src/contexts/ProjectContext.tsx'),
  'utf8',
);

describe('ProjectContext render safety', () => {
  test('memoizes provider value instead of broadcasting a fresh object on every provider render', () => {
    expect(projectContextSource).toContain('const contextValue = React.useMemo<ProjectContextType>');
    expect(projectContextSource).toContain('<ProjectContext.Provider value={contextValue}>');
    expect(projectContextSource).not.toContain('<ProjectContext.Provider value={{');
  });
});
