/**
 * Default Model Storage
 *
 * 管理 Claude 引擎的默认模型设置。
 * 新建会话使用此默认模型，历史会话保持原有模型记忆。
 */

import { ModelType } from "./types";

const STORAGE_KEY = "claude_default_model";

/**
 * 获取用户设置的默认模型
 * @returns 默认模型类型，如果未设置则返回 null
 */
export function getDefaultModel(): ModelType | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isValidModelType(stored)) {
      return stored as ModelType;
    }
    return null;
  } catch (error) {
    console.warn("[defaultModelStorage] Failed to get default model:", error);
    return null;
  }
}

/**
 * 设置默认模型
 * @param model 要设置为默认的模型类型
 */
export function setDefaultModel(model: ModelType): void {
  try {
    localStorage.setItem(STORAGE_KEY, model);
  } catch (error) {
    console.error("[defaultModelStorage] Failed to set default model:", error);
  }
}

/**
 * 清除默认模型设置
 */
export function clearDefaultModel(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error("[defaultModelStorage] Failed to clear default model:", error);
  }
}

/**
 * 检查给定模型是否为当前默认模型
 * @param model 要检查的模型类型
 * @returns 是否为默认模型
 */
export function isDefaultModel(model: ModelType): boolean {
  const defaultModel = getDefaultModel();
  return defaultModel === model;
}

/**
 * 验证模型类型是否有效。
 *
 * ModelType 已放宽为 string，可承载完整 model ID（如 claude-sonnet-5、claude-opus-4-6[1m]）。
 * 这里接受：旧别名字符串 或 任何以 "claude-" 开头的完整 model ID。
 */
function isValidModelType(value: string): value is ModelType {
  if (["fable", "sonnet", "opus", "haiku", "sonnet1m", "opus1m", "custom"].includes(value)) {
    return true;
  }
  return /^claude-/i.test(value);
}
