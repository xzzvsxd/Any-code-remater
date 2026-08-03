import React, { useState, useRef, forwardRef, useImperativeHandle, useEffect, useReducer, useCallback, useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { ArrowDown, LoaderCircle, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { FloatingPromptInputProps, FloatingPromptInputRef, ThinkingMode, ThinkingEffort, ModelType, ModelConfig, type ExecutionStatusInfo, type ExecutionEngineConfig } from "./types";
import { getModels } from "./constants";
import { toClaudeImageMention } from "@/lib/imagePath";
import { useImageHandling } from "./hooks/useImageHandling";
import { useFileSelection } from "./hooks/useFileSelection";
import { usePromptEnhancement } from "./hooks/usePromptEnhancement";
import { usePromptSuggestion } from "./hooks/usePromptSuggestion";
import { useDraftPersistence } from "./hooks/useDraftPersistence";
import { useSlashCommandMenu } from "./hooks/useSlashCommandMenu";
import { useCustomSlashCommands } from "./hooks/useCustomSlashCommands";
import { usePluginSlashCommands } from "./hooks/usePluginSlashCommands";
import { api, type ClaudeSettings } from "@/lib/api";
import { CLAUDE_AUTO_COMPACT_SETTINGS_CHANGED_EVENT } from "@/lib/claudeAutoCompact";
import { subscribeRuntimeConfigChanged } from '@/lib/runtimeConfigEvents';
import { getEnabledProviders } from "@/lib/promptEnhancementService";
import { formatDuration } from "@/lib/pricing";
import { inputReducer, initialState } from "./reducer";
import { getDefaultModel } from "./defaultModelStorage";
import { resolveSelectedModelName } from "./resolveModelName";
import { shouldSyncExecutionEngineConfig } from '@/components/executionEngineConfigPolicy';
import {
  buildPromptInputModelScopeKey,
  doesSessionModelOnlyDropOneMillion,
  parseSessionModelForPromptInput,
  readPromptInputLastSelectedModel,
  readPromptInputScopedModel,
  resolveInitialPromptInputModel,
  resolvePromptInputModelForScopeChange,
  shouldPersistPromptInputModelForScopeTransition,
  writePromptInputLastSelectedModel,
  writePromptInputScopedModel,
} from "./modelSessionScope";

// Import sub-components
import { InputArea } from "./InputArea";
import { AttachmentPreview } from "./AttachmentPreview";
import { ControlBar } from "./ControlBar";
import { ExpandedModal } from "./ExpandedModal";
import {
  resolvePromptActionButtonState,
  shouldSubmitPromptFromEnterKey,
  shouldSuppressPromptEnterNewline,
} from "./promptActionButtonState";

// Re-export types for external use
export type { FloatingPromptInputRef, FloatingPromptInputProps, ThinkingMode, ModelType, ExecutionStatusInfo } from "./types";

const ProcessingStatusCopy: React.FC<{ executionStatus?: ExecutionStatusInfo }> = ({ executionStatus }) => {
  const { t } = useTranslation();

  if (!executionStatus) {
    return (
      <>
        <div className="text-sm font-medium text-foreground/90">
          {t('floatingInput.processingStatus', '处理中')}
        </div>
        <div className="text-xs text-muted-foreground">
          {t('floatingInput.processingStatusHint', '正在持续输出，你可以继续查看历史消息')}
        </div>
      </>
    );
  }

  const hasOutputTimestamp = Boolean(executionStatus.lastOutputAt);
  const idleSeconds = hasOutputTimestamp
    ? Math.max(0, Math.floor(executionStatus.idleSeconds))
    : 0;
  const statusLabel = executionStatus.isCancelling
    ? `正在取消当前 ${executionStatus.engineName} 会话...`
    : `${executionStatus.engineName} 正在执行`;
  const statusHint = idleSeconds >= 60
    ? `已 ${formatDuration(idleSeconds)} 无新输出，可能仍在后台执行。完成后会弹出提醒。`
    : executionStatus.canCancel
      ? `取消只会影响当前会话${executionStatus.projectLabel ? `（${executionStatus.projectLabel}）` : ''}，不会断开其他对话。`
      : '正在启动进程，拿到当前会话 ID 后即可安全取消。';

  return (
    <>
      <div className="text-sm font-medium text-foreground/90">
        {statusLabel}
      </div>
      <div className="text-xs text-muted-foreground">
        {statusHint}
      </div>
    </>
  );
};

const NOOP_CANCEL_HANDLER = () => {};

/**
 * FloatingPromptInput - Refactored modular component
 */
const FloatingPromptInputInner = (
  {
    onSend,
    isLoading = false,
    showProcessingStatus = false,
    onProcessingStatusClick,
    disabled = false,
    defaultModel = "sonnet",
    sessionModel,
    projectPath,
    sessionId,
    projectId,
    draftTabId,
    className,
    onCancel,
    getConversationContext,
    messages,
    isPlanMode = false,
    onTogglePlanMode,
    sessionCost,
    sessionStats,
    hasMessages = false,
    session,
    codexRateLimits,
    executionEngineConfig: externalEngineConfig,
    executionStatus,
    onExecutionEngineConfigChange,
  }: FloatingPromptInputProps,
  ref: React.Ref<FloatingPromptInputRef>,
) => {
  const { t } = useTranslation();
  const initialModelScopeKey = buildPromptInputModelScopeKey({ sessionId, draftTabId, projectPath });

  // Determine initial model:
  // 1. Scoped UI choice: preserves Claude 1M intent per session/draft
  // 2. Historical session: use sessionModel
  // 3. Fresh draft/new session: keep sticky 1M UI intent if present
  // 4. New session: use user's default model or fallback to "sonnet"
  const getInitialModel = (): ModelType => {
    return resolveInitialPromptInputModel({
      scopeKey: initialModelScopeKey,
      scopedModel: readPromptInputScopedModel(initialModelScopeKey),
      sessionModel,
      lastSelectedModel: readPromptInputLastSelectedModel(),
      userDefaultModel: getDefaultModel(),
      defaultModel,
    });
  };

  // Use Reducer for state management
  const [state, dispatch] = useReducer(inputReducer, {
    ...initialState,
    selectedModel: getInitialModel(),
    executionEngineConfig: externalEngineConfig || initialState.executionEngineConfig,
  });
  const lastReportedEngineConfigRef = useRef(state.executionEngineConfig);
  const [autoCompactSettings, setAutoCompactSettings] = useState<ClaudeSettings | null>(null);
  const modelScopeKey = useMemo(
    () => buildPromptInputModelScopeKey({ sessionId, draftTabId, projectPath }),
    [draftTabId, projectPath, sessionId],
  );
  const lastModelScopeKeyRef = useRef(modelScopeKey);
  const modelEditedByUserRef = useRef(false);
  const appliedSessionModelScopeKeyRef = useRef(
    parseSessionModelForPromptInput(sessionModel) ? modelScopeKey : ''
  );

  // 草稿持久化 Hook - 确保输入内容在页面切换后不丢失；新会话草稿落盘到后端(多草稿)
  const { saveDraft, clearDraft } = useDraftPersistence({
    sessionId,
    draftId: draftTabId,
    projectId,
    projectPath,
    engine: state.executionEngineConfig?.engine,
    onRestore: useCallback((draft: string) => {
      // 恢复草稿时更新 prompt 状态
      dispatch({ type: "SET_PROMPT", payload: draft });
    }, []),
  });

  // 监听「从侧栏草稿条目恢复正文」事件：仅当 tabId 匹配本输入框时回填，
  // 用于「草稿对应 tab 已关闭、需新建 tab 并回填正文」的场景。
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { tabId?: string; text?: string } | undefined;
      if (!detail || !draftTabId || detail.tabId !== draftTabId) return;
      if (typeof detail.text === 'string' && detail.text) {
        dispatch({ type: "SET_PROMPT", payload: detail.text });
      }
    };
    window.addEventListener('restore-draft-text', handler);
    return () => window.removeEventListener('restore-draft-text', handler);
  }, [draftTabId]);

  // Initialize enableProjectContext from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('enable_project_context');
      if (stored === 'true') {
        dispatch({ type: "SET_ENABLE_PROJECT_CONTEXT", payload: true });
      }
    } catch {
      // Ignore error
    }
  }, []);

  const parseThinkingEffort = (effort: unknown): ThinkingEffort | null => {
    if (typeof effort !== 'string') return null;
    if (effort === 'max') return 'xhigh'; // legacy value from older Any Code builds
    if (['low', 'medium', 'high', 'xhigh'].includes(effort)) return effort as ThinkingEffort;
    return null;
  };

  // Initialize thinking mode from settings.json (source of truth)
  // Claude Code: Read CLAUDE_CODE_EFFORT_LEVEL from settings.json env.
  // Keep legacy CLAUDE_CODE_THINKING_EFFORT/MAX_THINKING_TOKENS migration support.
  useEffect(() => {
    const initThinkingMode = async () => {
      try {
        const settings = await api.getClaudeSettings();
        setAutoCompactSettings(settings);
        const effort = parseThinkingEffort(
          settings?.env?.CLAUDE_CODE_EFFORT_LEVEL ?? settings?.env?.CLAUDE_CODE_THINKING_EFFORT
        );
        if (effort) {
          dispatch({ type: "SET_THINKING_MODE", payload: { mode: 'adaptive', effort } });
          localStorage.setItem('thinking_mode', 'adaptive');
          localStorage.setItem('thinking_effort', effort);
        } else {
          // Check legacy MAX_THINKING_TOKENS for backward compatibility
          const hasLegacy = settings?.env?.MAX_THINKING_TOKENS !== undefined;
          if (hasLegacy) {
            dispatch({ type: "SET_THINKING_MODE", payload: { mode: 'adaptive', effort: 'high' } });
            localStorage.setItem('thinking_mode', 'adaptive');
            localStorage.setItem('thinking_effort', 'high');
          } else {
            dispatch({ type: "SET_THINKING_MODE", payload: { mode: 'off' } });
            localStorage.setItem('thinking_mode', 'off');
          }
        }
      } catch (error) {
        console.error('[ThinkingMode] Failed to read settings, falling back to localStorage:', error);
        try {
          const stored = localStorage.getItem('thinking_mode');
          const storedEffort = parseThinkingEffort(localStorage.getItem('thinking_effort'));
          if (stored === 'adaptive' && storedEffort) {
            dispatch({ type: "SET_THINKING_MODE", payload: { mode: 'adaptive', effort: storedEffort } });
          } else {
            dispatch({ type: "SET_THINKING_MODE", payload: { mode: 'off' } });
          }
        } catch {
          // Ignore error
        }
      }
    };

    initThinkingMode();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const handleSettingsChanged = (event: Event) => {
      const settings = (event as CustomEvent<{ settings?: ClaudeSettings }>).detail?.settings;
      if (settings) {
        setAutoCompactSettings(settings);
        return;
      }

      void api.getClaudeSettings()
        .then((latestSettings) => {
          if (!cancelled) setAutoCompactSettings(latestSettings);
        })
        .catch((error) => {
          console.warn('[AutoCompact] Failed to refresh Claude settings:', error);
        });
    };

    window.addEventListener(CLAUDE_AUTO_COMPACT_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(CLAUDE_AUTO_COMPACT_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
    };
  }, []);

  // Sync external config changes
  useEffect(() => {
    if (
      externalEngineConfig
      && shouldSyncExecutionEngineConfig(state.executionEngineConfig, externalEngineConfig)
      && shouldSyncExecutionEngineConfig(lastReportedEngineConfigRef.current, externalEngineConfig)
    ) {
      dispatch({ type: "SET_EXECUTION_ENGINE_CONFIG", payload: externalEngineConfig });
    }
  }, [externalEngineConfig, state.executionEngineConfig]);

  // Persist execution engine config
  useEffect(() => {
    try {
      localStorage.setItem('execution_engine_config', JSON.stringify(state.executionEngineConfig));
      lastReportedEngineConfigRef.current = state.executionEngineConfig;
      onExecutionEngineConfigChange?.(state.executionEngineConfig);
    } catch (error) {
      console.error('[ExecutionEngine] Failed to save config to localStorage:', error);
    }
  }, [state.executionEngineConfig, onExecutionEngineConfigChange]);

  // 内置模型扁平列表（供发送路径/上下文窗口的 resolveSelectedModelName 兼容消费）。
  // 新家族数据为静态，无需再监听 MODEL_NAMES_UPDATED_EVENT 动态改名。
  const availableModels = useMemo<ModelConfig[]>(() => getModels(), []);

  // 环境变量注入的自定义模型（非内置家族），单独承载并作为"自定义"家族传给选择器。
  const [customModels, setCustomModels] = useState<ModelConfig[]>([]);

  // 🔧 Mac 输入法兼容：追踪 IME 组合输入状态
  const [isComposing, setIsComposing] = useState(false);
  // 记录 compositionend 时间戳，用于冷却期检测
  const compositionEndTimeRef = useRef(0);

  // Refs
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const expandedTextareaRef = useRef<HTMLTextAreaElement>(null);
  const heightAdjustFrameRef = useRef<number | null>(null);

  const effectiveOnCancel = onCancel ?? NOOP_CANCEL_HANDLER;

  const setPrompt = useCallback((prompt: string) => {
    dispatch({ type: "SET_PROMPT", payload: prompt });
  }, []);

  const appendPrompt = useCallback((text: string) => {
    dispatch({ type: "APPEND_PROMPT", payload: text });
  }, []);

  const setCursorPosition = useCallback((position: number) => {
    dispatch({ type: "SET_CURSOR_POSITION", payload: position });
  }, []);

  const setExecutionEngineConfig = useCallback((config: ExecutionEngineConfig) => {
    dispatch({ type: "SET_EXECUTION_ENGINE_CONFIG", payload: config });
  }, []);

  const setSelectedModel = useCallback((model: ModelType) => {
    modelEditedByUserRef.current = true;
    writePromptInputScopedModel(modelScopeKey, model);
    writePromptInputLastSelectedModel(model);
    dispatch({ type: "SET_MODEL", payload: model });
  }, [modelScopeKey]);

  const setShowCostPopover = useCallback((show: boolean) => {
    dispatch({ type: "SET_SHOW_COST_POPOVER", payload: show });
  }, []);

  const setEnableProjectContext = useCallback((enable: boolean) => {
    dispatch({ type: "SET_ENABLE_PROJECT_CONTEXT", payload: enable });
  }, []);

  const openExpandedInput = useCallback(() => {
    dispatch({ type: "SET_EXPANDED", payload: true });
  }, []);

  const closeExpandedInput = useCallback(() => {
    dispatch({ type: "SET_EXPANDED", payload: false });
  }, []);

  const handleCompositionStart = useCallback(() => {
    setIsComposing(true);
  }, []);

  const handleCompositionEnd = useCallback(() => {
    setIsComposing(false);
    compositionEndTimeRef.current = Date.now();
  }, []);

  // Custom hooks
  const {
    imageAttachments,
    embeddedImages,
    dragActive,
    handlePaste,
    handleRemoveImageAttachment,
    handleRemoveEmbeddedImage,
    handleDrag,
    handleDrop,
    addImage,
    setImageAttachments,
    setEmbeddedImages,
  } = useImageHandling({
    prompt: state.prompt,
    projectPath,
    isExpanded: state.isExpanded,
    onPromptChange: setPrompt,
    textareaRef,
    expandedTextareaRef,
  });

  const {
    showFilePicker,
    filePickerQuery,
    detectAtSymbol,
    updateFilePickerQuery,
    handleFileSelect,
    handleFilePickerClose,
    setShowFilePicker,
    setFilePickerQuery,
  } = useFileSelection({
    prompt: state.prompt,
    projectPath,
    cursorPosition: state.cursorPosition,
    isExpanded: state.isExpanded,
    onPromptChange: setPrompt,
    onCursorPositionChange: setCursorPosition,
    textareaRef,
    expandedTextareaRef,
  });


  const {
    isEnhancing,
    handleEnhancePromptWithAPI,
    enableDualAPI,
    setEnableDualAPI,
  } = usePromptEnhancement({
    prompt: state.prompt,
    isExpanded: state.isExpanded,
    onPromptChange: setPrompt,
    getConversationContext,
    messages,
    textareaRef,
    expandedTextareaRef,
    projectPath,
    sessionId,
    projectId,
    enableProjectContext: state.enableProjectContext,
    enableMultiRound: true,
  });

  // 🆕 Prompt Suggestions Hook
  const [enablePromptSuggestion, setEnablePromptSuggestion] = useState(() => {
    try {
      const stored = localStorage.getItem('enable_prompt_suggestion');
      return stored !== null ? stored === 'true' : true; // 默认启用
    } catch {
      return true;
    }
  });

  // Listen for setting changes from GeneralSettings
  useEffect(() => {
    const handleToggle = (e: CustomEvent<{ enabled: boolean }>) => {
      setEnablePromptSuggestion(e.detail.enabled);
    };
    window.addEventListener('prompt-suggestion-toggle', handleToggle as EventListener);
    return () => {
      window.removeEventListener('prompt-suggestion-toggle', handleToggle as EventListener);
    };
  }, []);

  const {
    suggestion,
    isLoading: isSuggestionLoading,
    acceptSuggestion,
    dismissSuggestion,
  } = usePromptSuggestion({
    messages: messages || [],
    currentPrompt: state.prompt,
    enabled: enablePromptSuggestion && !state.isExpanded && !isLoading && !disabled,
    debounceMs: 600,
  });

  // 🆕 斜杠命令支持 Claude 和 Gemini 引擎（Codex 暂不支持非交互式斜杠命令）
  const currentEngine = state.executionEngineConfig.engine;
  const isSlashCommandSupported = currentEngine === 'claude' || currentEngine === 'gemini';

  // 🆕 自定义斜杠命令 Hook - 从后端获取用户和项目命令
  // Claude: ~/.claude/commands/*.md
  // Gemini: ~/.gemini/commands/*.toml
  const { customCommands } = useCustomSlashCommands({
    projectPath,
    enabled: isSlashCommandSupported && !state.isExpanded && !disabled,
    engine: currentEngine,
  });

  // 🆕 插件斜杠命令 Hook - 从后端获取插件技能和命令
  const { pluginCommands } = usePluginSlashCommands({
    projectPath,
    enabled: isSlashCommandSupported && !state.isExpanded && !disabled,
  });

  // 合并自定义命令和插件命令
  const allCustomCommands = useMemo(() => {
    return [...customCommands, ...pluginCommands];
  }, [customCommands, pluginCommands]);

  const handleSlashCommandPromptSelect = useCallback((command: string) => {
    setPrompt(command);
  }, [setPrompt]);

  // 🆕 斜杠命令菜单 Hook
  const {
    isOpen: showSlashCommandMenu,
    query: slashCommandQuery,
    selectedIndex: slashCommandSelectedIndex,
    setSelectedIndex: setSlashCommandSelectedIndex,
    selectCommand: handleSlashCommandSelect,
    closeMenu: closeSlashCommandMenu,
    handleKeyDown: handleSlashCommandKeyDown,
  } = useSlashCommandMenu({
    prompt: state.prompt,
    // 替换当前输入为选中的命令
    onCommandSelect: handleSlashCommandPromptSelect,
    customCommands: allCustomCommands,
    // Claude 和 Gemini 都支持斜杠命令菜单
    disabled: !isSlashCommandSupported || state.isExpanded || disabled,
    engine: currentEngine,
  });

  // Persist project context switch
  useEffect(() => {
    try {
      localStorage.setItem('enable_project_context', state.enableProjectContext.toString());
    } catch (error) {
      console.warn('Failed to save enable_project_context to localStorage:', error);
    }
  }, [state.enableProjectContext]);

  // Restore session model only when the input is reused for a different
  // session/draft scope.  Same-scope session.model updates can be late runtime
  // echoes and must not clear the user's 1M selection.
  useEffect(() => {
    const previousScopeKey = lastModelScopeKeyRef.current;
    const nextScopeKey = modelScopeKey;
    const parsedSessionModel = parseSessionModelForPromptInput(sessionModel);
    const scopedModel = readPromptInputScopedModel(nextScopeKey);

    if (previousScopeKey === nextScopeKey) {
      if (
        parsedSessionModel
        && !modelEditedByUserRef.current
        && !scopedModel
        && appliedSessionModelScopeKeyRef.current !== nextScopeKey
        && parsedSessionModel !== state.selectedModel
        && !doesSessionModelOnlyDropOneMillion(state.selectedModel, parsedSessionModel)
      ) {
        appliedSessionModelScopeKeyRef.current = nextScopeKey;
        dispatch({ type: "SET_MODEL", payload: parsedSessionModel });
      } else if (parsedSessionModel && appliedSessionModelScopeKeyRef.current !== nextScopeKey) {
        appliedSessionModelScopeKeyRef.current = nextScopeKey;
      }
      return;
    }

    modelEditedByUserRef.current = false;
    const nextModel = resolvePromptInputModelForScopeChange({
      previousScopeKey,
      nextScopeKey,
      currentModel: state.selectedModel,
      scopedModel,
      sessionModel,
      userDefaultModel: getDefaultModel(),
      defaultModel,
    });

    lastModelScopeKeyRef.current = nextScopeKey;
    appliedSessionModelScopeKeyRef.current = parsedSessionModel ? nextScopeKey : '';

    if (shouldPersistPromptInputModelForScopeTransition({
      previousScopeKey,
      nextScopeKey,
      currentModel: state.selectedModel,
      sessionModel,
      nextModel,
    })) {
      writePromptInputScopedModel(nextScopeKey, nextModel);
      writePromptInputLastSelectedModel(nextModel);
    }

    if (nextModel !== state.selectedModel) {
      dispatch({ type: "SET_MODEL", payload: nextModel });
    }
  }, [defaultModel, modelScopeKey, sessionModel, state.selectedModel]);

  useEffect(() => {
    if (state.executionEngineConfig.engine === 'claude') {
      writePromptInputLastSelectedModel(state.selectedModel);
    }
  }, [state.executionEngineConfig.engine, state.selectedModel]);

  const applyCustomModelSettings = useCallback((settings: ClaudeSettings) => {
    const envVars = settings?.data?.env || settings?.env;
    const customModel = envVars && typeof envVars === 'object'
      ? envVars.ANTHROPIC_MODEL
        || envVars.ANTHROPIC_DEFAULT_FABLE_MODEL
        || envVars.ANTHROPIC_DEFAULT_SONNET_MODEL
        || envVars.ANTHROPIC_DEFAULT_OPUS_MODEL
      : undefined;

    if (!customModel || typeof customModel !== 'string') {
      setCustomModels([]);
      return;
    }

    const lower = customModel.toLowerCase();
    const isBuiltInModel =
      ['fable', 'sonnet', 'opus', 'haiku', 'sonnet1m', 'opus1m'].includes(lower)
      || /^claude-/i.test(lower);
    setCustomModels(isBuiltInModel ? [] : [{
      id: customModel as ModelType,
      name: customModel,
      description: "Custom model from environment variables",
      icon: <Sparkles className="h-4 w-4" />,
    }]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api.getClaudeSettings()
      .then((settings) => {
        if (!cancelled) applyCustomModelSettings(settings);
      })
      .catch((error) => {
        console.error('[FloatingPromptInput] Failed to load custom model:', error);
      });

    const unsubscribe = subscribeRuntimeConfigChanged((detail) => {
      if (detail.engine === 'claude') {
        if (detail.settings) {
          setAutoCompactSettings(detail.settings);
          applyCustomModelSettings(detail.settings);
        }
        if (detail.model) setSelectedModel(detail.model as ModelType);
        return;
      }

      if (!detail.model) return;
      dispatch({
        type: 'PATCH_EXECUTION_ENGINE_CONFIG',
        payload: detail.engine === 'codex'
          ? { codexModel: detail.model }
          : { geminiModel: detail.model },
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [applyCustomModelSettings, setSelectedModel]);

  // Imperative handle
  useImperativeHandle(ref, () => ({
    addImage,
    setPrompt,
    appendPrompt,
  }), [addImage, appendPrompt, setPrompt]);

  // Toggle thinking mode - cycle through: off → high → xhigh → low → medium → off
  const EFFORT_CYCLE: (ThinkingEffort | 'off')[] = ['off', 'high', 'xhigh', 'low', 'medium'];

  // 应用思考模式的底层逻辑（dispatch + localStorage + 后端同步 + 失败回滚）。
  // toggle（Tab 快捷键）与弹窗内的直接分段选择共用此函数，避免逻辑重复扩散（DRY）。
  const applyThinkingMode = useCallback(async (nextKey: ThinkingEffort | 'off') => {
    const currentMode = state.selectedThinkingMode;
    const currentEffort = state.selectedThinkingEffort;

    const newMode: ThinkingMode = nextKey === 'off' ? 'off' : 'adaptive';
    const newEffort: ThinkingEffort | undefined = nextKey === 'off' ? undefined : nextKey as ThinkingEffort;

    dispatch({ type: "SET_THINKING_MODE", payload: { mode: newMode, effort: newEffort } });

    // Persist to localStorage
    try {
      localStorage.setItem('thinking_mode', newMode);
      if (newEffort) localStorage.setItem('thinking_effort', newEffort);
      else localStorage.removeItem('thinking_effort');
    } catch {
      // Ignore localStorage errors
    }

    try {
      await api.updateThinkingMode(newMode === 'adaptive', newEffort);
    } catch (error) {
      console.error("Failed to update thinking mode:", error);
      // Revert on error
      dispatch({ type: "SET_THINKING_MODE", payload: { mode: currentMode, effort: currentEffort } });
      try {
        localStorage.setItem('thinking_mode', currentMode);
        if (currentEffort) localStorage.setItem('thinking_effort', currentEffort);
      } catch {
        // Ignore localStorage errors
      }
    }
  }, [state.selectedThinkingMode, state.selectedThinkingEffort]);

  // 循环切换（Tab 快捷键）：off → high → xhigh → low → medium → off
  const handleToggleThinkingMode = useCallback(async () => {
    const currentMode = state.selectedThinkingMode;
    const currentEffort = state.selectedThinkingEffort;
    const currentKey = currentMode === 'off' ? 'off' : (currentEffort || 'high');
    const currentIndex = EFFORT_CYCLE.indexOf(currentKey);
    const nextIndex = (currentIndex + 1) % EFFORT_CYCLE.length;
    await applyThinkingMode(EFFORT_CYCLE[nextIndex]);
  }, [state.selectedThinkingMode, state.selectedThinkingEffort, applyThinkingMode]);

  // 直接设置思考程度（弹窗内分段选择），传 'off' 关闭
  const handleSetThinkingEffort = useCallback((effort: ThinkingEffort | 'off') => {
    void applyThinkingMode(effort);
  }, [applyThinkingMode]);

  // Focus management
  useEffect(() => {
    if (state.isExpanded && expandedTextareaRef.current) {
      expandedTextareaRef.current.focus();
    } else if (!state.isExpanded && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [state.isExpanded]);

  const cancelTextareaHeightAdjust = useCallback(() => {
    if (heightAdjustFrameRef.current !== null) {
      window.cancelAnimationFrame(heightAdjustFrameRef.current);
      heightAdjustFrameRef.current = null;
    }
  }, []);

  // Auto-resize textarea.
  // 读 scrollHeight 会强制布局；在输入/流式父级重渲染叠加时同步读写会放大卡顿。
  // 合并到 rAF 后，一帧内多次 prompt 更新只测一次，跨平台都能降低 layout thrash。
  const scheduleTextareaHeightAdjust = useCallback((textarea: HTMLTextAreaElement | null) => {
    cancelTextareaHeightAdjust();
    if (!textarea) return;

    heightAdjustFrameRef.current = window.requestAnimationFrame(() => {
      heightAdjustFrameRef.current = null;
      if (!textarea.isConnected) return;

      // 在改高度前先记录光标是否落在文本末尾。设 height='auto' 会触发回流，
      // 必须在此之前读取，避免读到失真的 selection。
      const caretAtEnd =
        textarea.selectionStart === textarea.selectionEnd &&
        textarea.selectionEnd >= textarea.value.length;

      textarea.style.height = 'auto';
      const maxHeight = state.isExpanded ? 600 : 300;
      const scrollHeight = textarea.scrollHeight;
      const newHeight = Math.min(scrollHeight, maxHeight);
      textarea.style.height = `${newHeight}px`;
      // 仅在「追加输入（光标在末尾）」时贴底，保证刚输入的内容可见。
      // 在中间编辑长文本时强行贴底会把视图甩到结尾，逼用户反复回滚定位——
      // 此时交给浏览器原生的「保持光标可见」即可，不要覆盖 scrollTop。
      if (scrollHeight > maxHeight && caretAtEnd) {
        textarea.scrollTop = scrollHeight;
      }
    });
  }, [cancelTextareaHeightAdjust, state.isExpanded]);

  useEffect(() => {
    const textarea = state.isExpanded ? expandedTextareaRef.current : textareaRef.current;
    scheduleTextareaHeightAdjust(textarea);
  }, [state.prompt, state.isExpanded, scheduleTextareaHeightAdjust]);

  useEffect(() => cancelTextareaHeightAdjust, [cancelTextareaHeightAdjust]);

  // Tab key listener - 🆕 只在没有建议时切换 thinking mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const activeElement = document.activeElement;
        const isInTextarea = activeElement?.tagName === 'TEXTAREA';
        // 🆕 在 textarea 中且有建议时，不处理（由组件内部 handleKeyDown 处理）
        if (isInTextarea && suggestion) {
          return;
        }
        if (!isInTextarea && !disabled) {
          e.preventDefault();
          handleToggleThinkingMode();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [disabled, handleToggleThinkingMode, suggestion]);

  // Event handlers
  const handleSend = useCallback(() => {
    // Allow sending if there's text content OR image attachments
    if ((state.prompt.trim() || imageAttachments.length > 0) && !disabled) {
      let finalPrompt = state.prompt.trim();
      if (imageAttachments.length > 0) {
        // Codex CLI doesn't recognize @ prefix syntax, use direct paths instead
        // Claude Code CLI uses @ prefix to reference files
        const isCodex = state.executionEngineConfig.engine === 'codex';
        const imagePathMentions = imageAttachments.map(attachment => {
          if (isCodex) {
            // For Codex: use direct path without @ prefix
            return attachment.filePath.includes(' ') ? `"${attachment.filePath}"` : attachment.filePath;
          } else {
            // For Claude Code: 规范化分隔符并构造 @引用，避免反斜杠被 CLI 当转义吞掉
            return toClaudeImageMention(attachment.filePath);
          }
        }).join(' ');

        finalPrompt = finalPrompt + (finalPrompt.endsWith(' ') || finalPrompt === '' ? '' : ' ') + imagePathMentions;
      }

      // When custom model is selected, pass the actual model name instead of "custom"
      // 与上下文窗口计算共用同一解析（resolveModelName），避免逻辑重复扩散。
      const modelToSend = resolveSelectedModelName(state.selectedModel, availableModels) as ModelType;

      if (state.executionEngineConfig.engine === 'claude') {
        writePromptInputScopedModel(modelScopeKey, state.selectedModel);
        writePromptInputLastSelectedModel(state.selectedModel);
      }

      onSend(finalPrompt, modelToSend, undefined);
      dispatch({ type: "RESET_INPUT" });
      setImageAttachments([]);
      setEmbeddedImages([]);
      // 发送成功后清除草稿
      clearDraft();
    }
  }, [
    availableModels,
    clearDraft,
    disabled,
    imageAttachments,
    modelScopeKey,
    onSend,
    setEmbeddedImages,
    setImageAttachments,
    state.executionEngineConfig.engine,
    state.prompt,
    state.selectedModel,
  ]);

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const newCursorPosition = e.target.selectionStart || 0;
    detectAtSymbol(newValue, newCursorPosition);
    updateFilePickerQuery(newValue, newCursorPosition);
    setPrompt(newValue);
    setCursorPosition(newCursorPosition);
    // 保存草稿
    saveDraft(newValue);
  }, [detectAtSymbol, saveDraft, setCursorPosition, setPrompt, updateFilePickerQuery]);

  const canCancelExecution = !executionStatus || executionStatus.canCancel;
  const isCancellingExecution = executionStatus?.isCancelling === true;

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // 🆕 优先处理斜杠命令菜单的键盘事件
    if (handleSlashCommandKeyDown(e)) {
      return;
    }

    if (showFilePicker && e.key === 'Escape') {
      e.preventDefault();
      setShowFilePicker(false);
      setFilePickerQuery("");
      return;
    }

    // 🆕 Tab 键接受建议 (斜杠命令菜单未打开时)
    if (e.key === 'Tab' && !e.shiftKey && suggestion && !showFilePicker && !showSlashCommandMenu) {
      e.preventDefault();
      const accepted = acceptSuggestion();
      if (accepted) {
        setPrompt(accepted);
      }
      return;
    }

    // 🆕 Escape 键取消建议
    if (e.key === 'Escape' && suggestion && !showFilePicker) {
      e.preventDefault();
      dismissSuggestion();
      return;
    }

    if (e.key === "Enter") {
      const timeSinceCompositionEnd = Date.now() - compositionEndTimeRef.current;
      const actionButtonState = resolvePromptActionButtonState({
        isLoading,
        prompt: state.prompt,
        hasAttachments: imageAttachments.length > 0,
        disabled,
        canCancelExecution,
        isCancellingExecution,
      });

      if (shouldSubmitPromptFromEnterKey({
        key: e.key,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        isExpanded: state.isExpanded,
        isFilePickerOpen: showFilePicker,
        actionMode: actionButtonState.mode,
        actionDisabled: actionButtonState.disabled,
        isComposing,
        nativeIsComposing: e.nativeEvent.isComposing,
        keyCode: e.nativeEvent.keyCode,
        which: (e.nativeEvent as any).which,
        timeSinceCompositionEndMs: timeSinceCompositionEnd,
      })) {
        e.preventDefault();
        dismissSuggestion(); // 🆕 发送时清除建议
        handleSend();
        return;
      }

      // 紧凑输入框里 Enter 的语义是“提交”。当当前动作是取消（运行中且输入为空）
      // 时不要误提交，也不要插入一个看不见的换行把“空输入”变成草稿噪音。
      // 同时覆盖“发送可用但被 IME 冷却期误挡”的旧路径：plain Enter 在紧凑输入框
      // 永远不应插入换行；Shift+Enter 才换行。
      if (shouldSuppressPromptEnterNewline({
        key: e.key,
        shiftKey: e.shiftKey,
        isFilePickerOpen: showFilePicker,
        isComposing,
        nativeIsComposing: e.nativeEvent.isComposing,
        keyCode: e.nativeEvent.keyCode,
        which: (e.nativeEvent as any).which,
      })) {
        e.preventDefault();
      }
    }
  }, [
    acceptSuggestion,
    canCancelExecution,
    disabled,
    dismissSuggestion,
    handleSend,
    handleSlashCommandKeyDown,
    imageAttachments.length,
    isComposing,
    isCancellingExecution,
    isLoading,
    setFilePickerQuery,
    setPrompt,
    setShowFilePicker,
    showFilePicker,
    showSlashCommandMenu,
    state.isExpanded,
    state.prompt,
    suggestion,
  ]);

  return (
    <>
      {/* Expanded Modal */}
      <AnimatePresence>
        {state.isExpanded && (
          <ExpandedModal
            ref={expandedTextareaRef}
            prompt={state.prompt}
            disabled={disabled}
            imageAttachments={imageAttachments}
            embeddedImages={embeddedImages}
            executionEngineConfig={state.executionEngineConfig}
            setExecutionEngineConfig={setExecutionEngineConfig}
            selectedModel={state.selectedModel}
            setSelectedModel={setSelectedModel}
            availableModels={availableModels}
            selectedThinkingMode={state.selectedThinkingMode}
            selectedThinkingEffort={state.selectedThinkingEffort}
            handleToggleThinkingMode={handleToggleThinkingMode}
            onSetThinkingEffort={handleSetThinkingEffort}
            customModels={customModels}
            isPlanMode={isPlanMode}
            onTogglePlanMode={onTogglePlanMode}
            isEnhancing={isEnhancing}
            projectPath={projectPath}
            enableProjectContext={state.enableProjectContext}
            setEnableProjectContext={setEnableProjectContext}
            enableDualAPI={enableDualAPI}
            setEnableDualAPI={setEnableDualAPI}
            getEnabledProviders={getEnabledProviders}
            handleEnhancePromptWithAPI={handleEnhancePromptWithAPI}
            onClose={closeExpandedInput}
            onRemoveAttachment={handleRemoveImageAttachment}
            onRemoveEmbedded={handleRemoveEmbeddedImage}
            onTextChange={handleTextChange}
            onPaste={handlePaste}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onSend={handleSend}
            isLoading={isLoading}
            executionStatus={executionStatus}
            onCancel={effectiveOnCancel}
          />
        )}
      </AnimatePresence>

      {/* ✅ 重构布局: 输入区域不再使用 fixed 定位，作为 Flex 容器的一部分 */}
      <div className={cn(
        "flex-shrink-0 border-t border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-[var(--glass-blur)] shadow-[var(--glass-shadow)]",
        className
      )}>
        <AttachmentPreview
          imageAttachments={imageAttachments}
          embeddedImages={embeddedImages}
          onRemoveAttachment={handleRemoveImageAttachment}
          onRemoveEmbedded={handleRemoveEmbeddedImage}
          className="border-b border-border/50 p-4"
        />

        <div className="p-4 space-y-2">
          {showProcessingStatus && (
            <div
              className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2"
              role="status"
              aria-live="polite"
            >
              <button
                type="button"
                onClick={onProcessingStatusClick}
                className={cn(
                  "flex w-full flex-col items-start gap-2 text-left sm:flex-row sm:items-center sm:justify-between",
                  onProcessingStatusClick && "cursor-pointer"
                )}
              >
                <div className="flex min-w-0 items-start gap-2 sm:items-center">
                  <LoaderCircle className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin text-amber-500 sm:mt-0" />
                  <div className="min-w-0">
                    <ProcessingStatusCopy executionStatus={executionStatus} />
                  </div>
                </div>

                {onProcessingStatusClick && (
                  <div className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                    <span>{t('floatingInput.processingStatusAction', '回到最新消息')}</span>
                    <ArrowDown className="h-3.5 w-3.5" />
                  </div>
                )}
              </button>
            </div>
          )}

          <InputArea
            ref={textareaRef}
            prompt={state.prompt}
            disabled={disabled}
            dragActive={dragActive}
            showFilePicker={showFilePicker}
            projectPath={projectPath}
            filePickerQuery={filePickerQuery}
            onTextChange={handleTextChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onExpand={openExpandedInput}
            onFileSelect={handleFileSelect}
            onFilePickerClose={handleFilePickerClose}
            // 🔧 Mac 输入法兼容
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            // 🆕 Prompt Suggestions
            suggestion={suggestion}
            isSuggestionLoading={isSuggestionLoading}
            enableSuggestion={enablePromptSuggestion}
            // 🆕 斜杠命令菜单
            showSlashCommandMenu={showSlashCommandMenu}
            slashCommandQuery={slashCommandQuery}
            slashCommandSelectedIndex={slashCommandSelectedIndex}
            onSlashCommandSelect={handleSlashCommandSelect}
            onSlashCommandMenuClose={closeSlashCommandMenu}
            onSlashCommandSelectedIndexChange={setSlashCommandSelectedIndex}
            customSlashCommands={allCustomCommands}
            engine={currentEngine}
          />

          <ControlBar
            disabled={disabled}
            isLoading={isLoading}
            prompt={state.prompt}
            hasAttachments={imageAttachments.length > 0}
            executionEngineConfig={state.executionEngineConfig}
            setExecutionEngineConfig={setExecutionEngineConfig}
            selectedModel={state.selectedModel}
            setSelectedModel={setSelectedModel}
            availableModels={availableModels}
            selectedThinkingMode={state.selectedThinkingMode}
            selectedThinkingEffort={state.selectedThinkingEffort}
            handleToggleThinkingMode={handleToggleThinkingMode}
            onSetThinkingEffort={handleSetThinkingEffort}
            customModels={customModels}
            isPlanMode={isPlanMode}
            onTogglePlanMode={onTogglePlanMode}
            hasMessages={hasMessages}
            sessionCost={sessionCost}
            sessionStats={sessionStats}
            showCostPopover={state.showCostPopover}
            setShowCostPopover={setShowCostPopover}
            messages={messages}
            session={session}
            autoCompactSettings={autoCompactSettings}
            codexRateLimits={codexRateLimits}
            isEnhancing={isEnhancing}
            executionStatus={executionStatus}
            projectPath={projectPath}
            enableProjectContext={state.enableProjectContext}
            setEnableProjectContext={setEnableProjectContext}
            enableDualAPI={enableDualAPI}
            setEnableDualAPI={setEnableDualAPI}
            getEnabledProviders={getEnabledProviders}
            handleEnhancePromptWithAPI={handleEnhancePromptWithAPI}
            onCancel={effectiveOnCancel}
            onSend={handleSend}
          />
        </div>
      </div>
    </>
  );
};

export const FloatingPromptInput = forwardRef(FloatingPromptInputInner);
