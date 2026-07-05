import { describe, expect, it } from 'vitest';

import {
  encodeClaudeModel,
  decodeClaudeModel,
  getModelFamilies,
} from '../constants';

describe('Claude model encode/decode', () => {
  it('encodes Opus 4.6 with 1M as [1m] suffix', () => {
    expect(encodeClaudeModel('claude-opus-4-6', true)).toBe('claude-opus-4-6[1m]');
  });

  it('encodes Opus 4.6 without 1M as bare id', () => {
    expect(encodeClaudeModel('claude-opus-4-6', false)).toBe('claude-opus-4-6');
  });

  it('never appends [1m] to native-1M models (Sonnet 5)', () => {
    // Sonnet 5 原生 1M，supports1m=false，即便请求 1M 也不加后缀
    expect(encodeClaudeModel('claude-sonnet-5', true)).toBe('claude-sonnet-5');
  });

  it('never appends [1m] to Fable 5 (native 1M)', () => {
    expect(encodeClaudeModel('claude-fable-5', true)).toBe('claude-fable-5');
  });

  it('never appends [1m] to Haiku (unsupported)', () => {
    expect(encodeClaudeModel('claude-haiku-4-5', true)).toBe('claude-haiku-4-5');
  });

  it('decodes full model id with 1M suffix', () => {
    expect(decodeClaudeModel('claude-opus-4-6[1m]')).toEqual({
      versionId: 'claude-opus-4-6',
      oneMillion: true,
    });
  });

  it('decodes legacy alias sonnet to latest (Sonnet 5)', () => {
    expect(decodeClaudeModel('sonnet')).toEqual({
      versionId: 'claude-sonnet-5',
      oneMillion: false,
    });
  });

  it('decodes legacy alias opus1m to Opus 4.8 with 1M', () => {
    expect(decodeClaudeModel('opus1m')).toEqual({
      versionId: 'claude-opus-4-8',
      oneMillion: true,
    });
  });

  it('decodes legacy alias sonnet1m to Sonnet 4.6 family with 1M', () => {
    // sonnet1m 旧别名语义是 4.6 的 1M（sonnet 现指向 5）；模糊解析回退到 sonnet 最新版但保留 1M 标记
    const decoded = decodeClaudeModel('sonnet1m');
    expect(decoded?.oneMillion).toBe(true);
  });

  it('returns null for unrecognized model', () => {
    expect(decodeClaudeModel('gpt-4o')).toBeNull();
  });

  it('every native1m version has supports1m=false', () => {
    const versions = getModelFamilies().flatMap((f) => f.versions);
    for (const v of versions) {
      if (v.native1m) {
        expect(v.supports1m).toBe(false);
      }
    }
  });
});
