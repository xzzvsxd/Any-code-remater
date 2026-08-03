import { ModelType, ThinkingMode, ThinkingEffort, ExecutionEngineConfig } from "./types";
import { DEFAULT_CODEX_MODEL_ID } from "@/lib/codexModelSupport";

export interface InputState {
  prompt: string;
  selectedModel: ModelType;
  selectedThinkingMode: ThinkingMode;
  selectedThinkingEffort?: ThinkingEffort;
  isExpanded: boolean;
  showCostPopover: boolean;
  cursorPosition: number;
  executionEngineConfig: ExecutionEngineConfig;
  enableProjectContext: boolean;
}

export type InputAction =
  | { type: "SET_PROMPT"; payload: string }
  | { type: "APPEND_PROMPT"; payload: string }
  | { type: "SET_MODEL"; payload: ModelType }
  | { type: "SET_THINKING_MODE"; payload: { mode: ThinkingMode; effort?: ThinkingEffort } }
  | { type: "SET_EXPANDED"; payload: boolean }
  | { type: "SET_SHOW_COST_POPOVER"; payload: boolean }
  | { type: "SET_CURSOR_POSITION"; payload: number }
  | { type: "SET_EXECUTION_ENGINE_CONFIG"; payload: ExecutionEngineConfig }
  | { type: "PATCH_EXECUTION_ENGINE_CONFIG"; payload: Partial<ExecutionEngineConfig> }
  | { type: "SET_ENABLE_PROJECT_CONTEXT"; payload: boolean }
  | { type: "RESET_INPUT" };

export const initialState: InputState = {
  prompt: "",
  selectedModel: "sonnet",
  selectedThinkingMode: "off",
  selectedThinkingEffort: undefined,
  isExpanded: false,
  showCostPopover: false,
  cursorPosition: 0,
  executionEngineConfig: {
    engine: "claude",
    codexMode: "read-only",
    codexModel: DEFAULT_CODEX_MODEL_ID,
    geminiModel: "gemini-3-flash",
  },
  enableProjectContext: false,
};

export function inputReducer(state: InputState, action: InputAction): InputState {
  switch (action.type) {
    case "SET_PROMPT":
      return { ...state, prompt: action.payload };
    case "APPEND_PROMPT": {
      const addition = action.payload;
      if (!addition) return state;
      // 当前非空则换行分隔后追加，避免内容粘连；为空时直接置入。
      // 在 reducer 内拼接可避免 imperative handle 闭包读到 stale 的 state.prompt。
      const next = state.prompt ? `${state.prompt}\n${addition}` : addition;
      return { ...state, prompt: next };
    }
    case "SET_MODEL":
      return { ...state, selectedModel: action.payload };
    case "SET_THINKING_MODE":
      return { ...state, selectedThinkingMode: action.payload.mode, selectedThinkingEffort: action.payload.effort };
    case "SET_EXPANDED":
      return { ...state, isExpanded: action.payload };
    case "SET_SHOW_COST_POPOVER":
      return { ...state, showCostPopover: action.payload };
    case "SET_CURSOR_POSITION":
      return { ...state, cursorPosition: action.payload };
    case "SET_EXECUTION_ENGINE_CONFIG":
      return { ...state, executionEngineConfig: action.payload };
    case "PATCH_EXECUTION_ENGINE_CONFIG":
      return {
        ...state,
        executionEngineConfig: { ...state.executionEngineConfig, ...action.payload },
      };
    case "SET_ENABLE_PROJECT_CONTEXT":
      return { ...state, enableProjectContext: action.payload };
    case "RESET_INPUT":
      return { ...state, prompt: "", isExpanded: false };
    default:
      return state;
  }
}
