import { useMemo, useRef } from 'react';
import {
  updatePromptIndexMapsCache,
  type PromptIndexMaps,
  type PromptIndexMapsCache,
} from '@/lib/promptIndex';
import type { ClaudeStreamMessage } from '@/types/claude';

const EMPTY_PROMPT_INDEX_MAPS: PromptIndexMaps = {
  promptIndexByMessage: new WeakMap(),
  branchPromptIndexByMessage: new WeakMap(),
};

/**
 * 为消息撤回/分支构建 prompt index 映射。
 *
 * 长会话 streaming 时 messages 以 append-only 为主；每帧全量扫描所有消息会让
 * Linux/WebKitGTK 主线程持续吃满。这里把 WeakMap 缓存在 ref 中，只处理新增后缀。
 */
export function usePromptIndexMaps(
  messages: ClaudeStreamMessage[],
): PromptIndexMaps {
  const cacheRef = useRef<PromptIndexMapsCache | null>(null);

  return useMemo(() => {
    if (messages.length === 0) {
      cacheRef.current = null;
      return EMPTY_PROMPT_INDEX_MAPS;
    }

    const cache = updatePromptIndexMapsCache(cacheRef.current, messages);
    cacheRef.current = cache;
    return {
      promptIndexByMessage: cache.promptIndexByMessage,
      branchPromptIndexByMessage: cache.branchPromptIndexByMessage,
    };
  }, [messages]);
}

export default usePromptIndexMaps;
