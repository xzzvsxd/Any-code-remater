/**
 * Official Claude Token Counter Service
 *
 * 鍩轰簬Claude瀹樻柟Token Count API鐨勫噯纭畉oken璁＄畻鏈嶅姟
 * 鏀寔鎵€鏈夋秷鎭被鍨嬪拰Claude妯″瀷鐨勭簿纭畉oken缁熻鍜屾垚鏈绠? *
 * 2026骞存渶鏂板畼鏂瑰畾浠峰拰Claude 4.7/4.6绯诲垪妯″瀷鏀寔
 */

import Anthropic from '@anthropic-ai/sdk';
import { api } from './api';

// ============================================================================
// Claude Model Pricing - MUST MATCH BACKEND (usage.rs)
// 鈿狅笍 WARNING: This pricing table MUST be kept in sync with:
//    src-tauri/src/commands/usage.rs::ModelPricing
// Source: https://docs.claude.com/en/docs/about-claude/models/overview
// Last Updated: May 2026
// ============================================================================

export const CLAUDE_PRICING = {
  // Claude 4.7 Series (Latest - May 2026)
  'claude-opus-4-7': {
    input: 15.0,
    output: 75.0,
    cache_write: 18.75,
    cache_read: 1.50,
  },
  // Claude 4.6 Series
  'claude-opus-4-6': {
    input: 15.0,
    output: 75.0,
    cache_write: 18.75,
    cache_read: 1.50,
  },
  'claude-sonnet-4-6': {
    input: 3.0,
    output: 15.0,
    cache_write: 3.75,
    cache_read: 0.30,
  },
  // Claude 4.5 Series
  'claude-opus-4-5': {
    input: 5.0,
    output: 25.0,
    cache_write: 6.25,
    cache_read: 0.50,
  },
  'claude-opus-4-5-20251101': {
    input: 5.0,
    output: 25.0,
    cache_write: 6.25,
    cache_read: 0.50,
  },
  'claude-sonnet-4-5': {
    input: 3.0,
    output: 15.0,
    cache_write: 3.75,
    cache_read: 0.30,
  },
  'claude-sonnet-4-5-20250929': {
    input: 3.0,
    output: 15.0,
    cache_write: 3.75,
    cache_read: 0.30,
  },
  'claude-haiku-4-5': {
    input: 1.0,
    output: 5.0,
    cache_write: 1.25,
    cache_read: 0.10,
  },
  'claude-haiku-4-5-20251001': {
    input: 1.0,
    output: 5.0,
    cache_write: 1.25,
    cache_read: 0.10,
  },
  // Claude 4.1 Series
  'claude-opus-4-1': {
    input: 15.0,
    output: 75.0,
    cache_write: 18.75,
    cache_read: 1.50,
  },
  'claude-opus-4-1-20250805': {
    input: 15.0,
    output: 75.0,
    cache_write: 18.75,
    cache_read: 1.50,
  },
  // 榛樿鍊?(浣跨敤鏈€鏂?Sonnet 4.6 瀹氫环)
  'default': {
    input: 3.0,
    output: 15.0,
    cache_write: 3.75,
    cache_read: 0.30,
  }
} as const;

// ============================================================================
// AI Model Context Windows
// 鍚勬ā鍨嬬殑涓婁笅鏂囩獥鍙ｅぇ灏忥紙tokens锛?// Claude: https://docs.claude.com/en/docs/about-claude/models/overview
// Codex: https://github.com/openai/codex (瀹樻柟鏂囨。)
// ============================================================================

export const CLAUDE_CONTEXT_WINDOWS = {
  // Claude 4.7 / 4.6 Series
  'claude-opus-4-7': 200000,
  'claude-opus-4-7[1m]': 1000000,
  'claude-opus-4-6': 200000,
  'claude-opus-4-6[1m]': 1000000,
  'claude-sonnet-4-6': 200000,
  'claude-sonnet-4-6[1m]': 1000000,
  // Claude 4.5 Series
  'claude-opus-4-5': 200000,
  'claude-opus-4-5-20251101': 200000,
  'claude-sonnet-4-5': 200000,
  'claude-sonnet-4-5-20250929': 200000,
  'claude-haiku-4-5': 200000,
  'claude-haiku-4-5-20251001': 200000,
  // Claude 4.1 Series
  'claude-opus-4-1': 200000,
  'claude-opus-4-1-20250805': 200000,
  'default': 200000,
  // 榛樿鍊?  'default': 200000,
} as const;

// ============================================================================
// Codex Model Context Windows
// Source: Codex CLI history token_count events expose model_context_window (e.g. 272000 for gpt-5-codex)
// ============================================================================

export const CODEX_CONTEXT_WINDOWS = {
  'gpt-5.5': 1_050_000,
  'gpt-5.5-pro': 1_050_000,
  'gpt-5.4': 1_050_000,
  'gpt-5.4-pro': 1_050_000,
  // GPT-5.3-Codex 绯诲垪 - 鏈€鏂颁唬鐮佹ā鍨嬶紙2026骞?鏈堝彂甯冿級
  // 400K context window, 128K max output
  'gpt-5.3-codex': 400000,
  'gpt-5.3-codex-spark': 400000,
  // GPT-5.2 绯诲垪
  'gpt-5.2': 272000,
  'gpt-5.2-codex': 272000,
  // GPT-5.1-Codex 绯诲垪
  'gpt-5.1-codex': 272000,
  'gpt-5.1-codex-mini': 272000,
  'gpt-5.1-codex-max': 272000,
  'gpt-5-codex': 272000,
  'codex-mini-latest': 272000,
  // o4-mini (Codex 搴曞眰妯″瀷)
  'o4-mini': 128000,
  'default': 400000,
  // 榛樿鍊?  'default': 400000,
} as const;

// ============================================================================
// Gemini Model Context Windows
// Source: https://ai.google.dev/gemini-api/docs/models (and model cards)
// NOTE: Current app configuration uses 1M context across supported Gemini models.
// ============================================================================

export const GEMINI_CONTEXT_WINDOWS = {
  'gemini-3.1-pro-preview': 2_000_000,
  'gemini-3-pro-preview': 1_000_000,
  'gemini-3-pro-image-preview': 1_000_000,
  'gemini-3-flash': 1_000_000,
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.5-flash': 1_000_000,
  'gemini-2.5-flash-lite': 1_000_000,
  'gemini-2.0-flash': 1_000_000,
  'gemini-2.0-flash-exp': 1_000_000,
  'default': 1_000_000,
} as const;

/**
 * 鑾峰彇妯″瀷鐨勪笂涓嬫枃绐楀彛澶у皬
 * @param model - 妯″瀷鍚嶇О
 * @param engine - 寮曟搸绫诲瀷锛坈laude/codex/gemini锛? * @returns 涓婁笅鏂囩獥鍙ｅぇ灏忥紙tokens锛? */
export function getContextWindowSize(model?: string, engine?: string): number {
  // Gemini 寮曟搸
  if (engine === 'gemini') {
    if (!model) return GEMINI_CONTEXT_WINDOWS['default'];

    const lowerModel = model.toLowerCase();

    // 澶勭悊 Vertex AI / provider 鍓嶇紑涓庣増鏈悗缂€
    const normalized = lowerModel
      .replace('google.', '')
      .replace('vertex.', '')
      .replace('-v1:0', '')
      .split('@')[0];

    if (normalized in GEMINI_CONTEXT_WINDOWS) {
      return GEMINI_CONTEXT_WINDOWS[normalized as keyof typeof GEMINI_CONTEXT_WINDOWS];
    }

    // 甯歌鍙樹綋锛?exp / -preview / 鐗堟湰鏃ユ湡鍚庣紑绛?-> 鍥為€€鍒板鏃忛粯璁?1M
    if (normalized.startsWith('gemini-')) {
      return GEMINI_CONTEXT_WINDOWS['default'];
    }

    return GEMINI_CONTEXT_WINDOWS['default'];
  }

  // Codex 寮曟搸
  if (engine === 'codex') {
    if (!model) return CODEX_CONTEXT_WINDOWS['default'];

    const lowerModel = model.toLowerCase();

    // 灏濊瘯鐩存帴鍖归厤
    if (lowerModel in CODEX_CONTEXT_WINDOWS) {
      return CODEX_CONTEXT_WINDOWS[lowerModel as keyof typeof CODEX_CONTEXT_WINDOWS];
    }

    if (lowerModel.includes('5.5-pro') || lowerModel.includes('5_5_pro')) {
      return CODEX_CONTEXT_WINDOWS['gpt-5.5-pro'];
    }
    if (lowerModel.includes('gpt-5.5') || lowerModel.includes('gpt_5_5') || lowerModel.includes('5.5')) {
      return CODEX_CONTEXT_WINDOWS['gpt-5.5'];
    }
    if (lowerModel.includes('5.4-pro') || lowerModel.includes('5_4_pro')) {
      return CODEX_CONTEXT_WINDOWS['gpt-5.4-pro'];
    }
    if (lowerModel.includes('gpt-5.4') || lowerModel.includes('gpt_5_4') || lowerModel.includes('5.4')) {
      return CODEX_CONTEXT_WINDOWS['gpt-5.4'];
    }

    // GPT-5.3-Codex 绯诲垪锛堟渶鏂帮級
    if (lowerModel.includes('5.3-codex-spark') || lowerModel.includes('5_3_codex_spark')) {
      return CODEX_CONTEXT_WINDOWS['gpt-5.3-codex-spark'];
    }
    if (lowerModel.includes('5.3-codex') || lowerModel.includes('5_3_codex')) {
      return CODEX_CONTEXT_WINDOWS['gpt-5.3-codex'];
    }
    if (lowerModel.includes('gpt-5.3') || lowerModel.includes('gpt_5_3')) {
      return CODEX_CONTEXT_WINDOWS['gpt-5.3-codex'];
    }

    // GPT-5.1-Codex 绯诲垪
    if (lowerModel.includes('5.1-codex-max') || lowerModel.includes('5_1_codex_max')) {
      return CODEX_CONTEXT_WINDOWS['gpt-5.1-codex-max'];
    }
    if (lowerModel.includes('5.1-codex-mini') || lowerModel.includes('5_1_codex_mini')) {
      return CODEX_CONTEXT_WINDOWS['gpt-5.1-codex-mini'];
    }
    if (lowerModel.includes('5.1-codex') || lowerModel.includes('5_1_codex')) {
      return CODEX_CONTEXT_WINDOWS['gpt-5.1-codex'];
    }

    // GPT-5.2 绯诲垪
    if (lowerModel.includes('5.2-codex') || lowerModel.includes('5_2_codex')) {
      return CODEX_CONTEXT_WINDOWS['gpt-5.2-codex'];
    }
    if (lowerModel.includes('gpt-5.2') || lowerModel.includes('gpt_5_2') || lowerModel.includes('5.2')) {
      return CODEX_CONTEXT_WINDOWS['gpt-5.2'];
    }

    // o4-mini
    if (lowerModel.includes('o4-mini') || lowerModel.includes('o4_mini')) {
      return CODEX_CONTEXT_WINDOWS['o4-mini'];
    }

    // codex-mini-latest - 榛樿 CLI 妯″瀷
    if (lowerModel.includes('codex-mini-latest') || lowerModel.includes('codex_mini_latest')) {
      return CODEX_CONTEXT_WINDOWS['codex-mini-latest'];
    }

    // gpt-5-codex (鍒悕)
    if (lowerModel.includes('gpt-5-codex') || lowerModel.includes('gpt_5_codex')) {
      return CODEX_CONTEXT_WINDOWS['gpt-5-codex'];
    }

    // 閫氱敤 Codex 鍖归厤 - 榛樿浣跨敤 codex-mini-latest (200K)
    if (lowerModel.includes('codex')) {
      return CODEX_CONTEXT_WINDOWS['codex-mini-latest'];
    }

    return CODEX_CONTEXT_WINDOWS['default'];
  }

  // Claude 寮曟搸锛堥粯璁わ級
  if (!model) return CLAUDE_CONTEXT_WINDOWS['default'];

  // 灏濊瘯鐩存帴鍖归厤
  if (model in CLAUDE_CONTEXT_WINDOWS) {
    return CLAUDE_CONTEXT_WINDOWS[model as keyof typeof CLAUDE_CONTEXT_WINDOWS];
  }

  // 灏濊瘯閫氳繃鍒悕鍖归厤
  const normalizedModel = MODEL_ALIASES[model as keyof typeof MODEL_ALIASES];
  if (normalizedModel && normalizedModel in CLAUDE_CONTEXT_WINDOWS) {
    return CLAUDE_CONTEXT_WINDOWS[normalizedModel as keyof typeof CLAUDE_CONTEXT_WINDOWS];
  }

  return CLAUDE_CONTEXT_WINDOWS['default'];
}
export const MODEL_ALIASES = {
  'opus': 'claude-opus-4-7',
  'opus1m': 'claude-opus-4-7[1m]',
  'opus4.7': 'claude-opus-4-7',
  'opus-4.7': 'claude-opus-4-7',
  'opus4.6': 'claude-opus-4-6',
  'opus-4.6': 'claude-opus-4-6',
  'opus4.5': 'claude-opus-4-5',
  'opus-4.5': 'claude-opus-4-5',
  'opus4.1': 'claude-opus-4-1',
  'opus-4.1': 'claude-opus-4-1',
  'sonnet': 'claude-sonnet-4-6',
  'sonnet1m': 'claude-sonnet-4-6[1m]',
  'sonnet4.6': 'claude-sonnet-4-6',
  'sonnet-4.6': 'claude-sonnet-4-6',
  'sonnet4.5': 'claude-sonnet-4-5',
  'sonnet-4.5': 'claude-sonnet-4-5',
  'haiku': 'claude-haiku-4-5',
  'haiku4.5': 'claude-haiku-4-5',
  'haiku-4.5': 'claude-haiku-4-5',
} as const;

/**
 * 鉁?Token浣跨敤缁熻鎺ュ彛
 *
 * @deprecated Consider using StandardizedTokenUsage from tokenExtractor.ts for new code.
 * This interface is kept for backward compatibility with existing code.
 *
 * For new implementations:
 * - Use `StandardizedTokenUsage` from tokenExtractor.ts (fully normalized with total_tokens)
 * - Use `RawTokenUsage` from tokenExtractor.ts (for handling various API response formats)
 * - Use `normalizeRawUsage()` from tokenExtractor.ts to convert raw data to standard format
 */
export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation_tokens?: number;
  cache_read_input_tokens?: number;
  cache_read_tokens?: number;
}

// 娑堟伅鎺ュ彛
export interface ClaudeMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{
    type: 'text' | 'image' | 'document';
    text?: string;
    source?: {
      type: 'base64';
      media_type: string;
      data: string;
    };
  }>;
}

// 宸ュ叿瀹氫箟鎺ュ彛
export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

// Token璁＄畻鍝嶅簲鎺ュ彛
export interface TokenCountResponse {
  input_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// 鎴愭湰鍒嗘瀽缁撴灉
export interface CostBreakdown {
  input_cost: number;
  output_cost: number;
  cache_write_cost: number;
  cache_read_cost: number;
  total_cost: number;
  total: number; // 鍚戝悗鍏煎瀛楁
}

// Token鏄庣粏鍒嗘瀽
export interface TokenBreakdown {
  total: number;
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
  cost: CostBreakdown;
  efficiency: {
    cache_hit_rate: number;
    cost_savings: number;
  };
}

export class TokenCounterService {
  private client: Anthropic | null = null;
  private apiKey: string | null = null;
  private baseURL: string | null = null;

  constructor() {
    this.initialize();
  }

  /**
   * 鍒濆鍖朅nthropic瀹㈡埛绔?   */
  private async initialize() {
    try {
      // 浠庡涓潵婧愯幏鍙朅PI瀵嗛挜
      this.apiKey = this.getApiKey();
      this.baseURL = this.getBaseURL();

      if (this.apiKey) {
        this.client = new Anthropic({
          apiKey: this.apiKey,
          baseURL: this.baseURL || undefined,
          defaultHeaders: {
            'anthropic-beta': 'prompt-caching-2024-07-31,token-counting-2024-11-01',
          },
        });
      }
    } catch (error) {
      console.warn('[TokenCounter] 鍒濆鍖栧け璐ワ紝灏嗕娇鐢ㄤ及绠楁柟娉?', error);
    }
  }

  /**
   * 鑾峰彇API瀵嗛挜
   */
  private getApiKey(): string | null {
    // 1. 鐜鍙橀噺
    if (typeof window !== 'undefined') {
      // 娴忚鍣ㄧ幆澧?      return null; // 娴忚鍣ㄤ腑涓嶅簲鐩存帴浣跨敤API瀵嗛挜
      return null;
    }

    // Node.js鐜
    return process.env.ANTHROPIC_API_KEY ||
           process.env.ANTHROPIC_AUTH_TOKEN ||
           null;
  }

  /**
   * 鑾峰彇鍩虹URL
   */
  private getBaseURL(): string | null {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('anthropic_base_url');
    }

    return process.env.ANTHROPIC_BASE_URL ||
           process.env.CLAUDE_API_BASE_URL ||
           null;
  }

  /**
   * 鏍囧噯鍖栨ā鍨嬪悕绉?   * 鈿狅笍 MUST MATCH: src-tauri/src/commands/usage.rs::parse_model_family
   *
   * This function replicates the backend logic to ensure consistent
   * model identification and pricing across frontend and backend.
   */
  public normalizeModel(model?: string): string {
    if (!model) return 'claude-sonnet-4-6';

    // Normalize: lowercase + remove common prefixes/suffixes
    let normalized = model.toLowerCase();
    normalized = normalized.replace('anthropic.', '');
    normalized = normalized.replace('-v1:0', '');

    // Handle @ symbol for Vertex AI format
    const atIndex = normalized.indexOf('@');
    if (atIndex !== -1) {
      normalized = normalized.substring(0, atIndex);
    }

    // Priority-based matching (order matters! MUST match backend logic)

    // Claude 4.7 Series (Latest)
    if (normalized.includes('opus') && (normalized.includes('4.7') || normalized.includes('4-7'))) {
      return 'claude-opus-4-7';
    }

    // Claude 4.6 Series
    if (normalized.includes('opus') && (normalized.includes('4.6') || normalized.includes('4-6'))) {
      return 'claude-opus-4-6';
    }
    if (normalized.includes('sonnet') && (normalized.includes('4.6') || normalized.includes('4-6'))) {
      return 'claude-sonnet-4-6';
    }

    // Claude 4.5 Series
    if (normalized.includes('opus') && (normalized.includes('4.5') || normalized.includes('4-5'))) {
      return 'claude-opus-4-5';
    }
    if (normalized.includes('haiku') && (normalized.includes('4.5') || normalized.includes('4-5'))) {
      return 'claude-haiku-4-5';
    }
    if (normalized.includes('sonnet') && (normalized.includes('4.5') || normalized.includes('4-5'))) {
      return 'claude-sonnet-4-5';
    }

    // Claude 4.1 Series
    if (normalized.includes('opus') && (normalized.includes('4.1') || normalized.includes('4-1'))) {
      return 'claude-opus-4-1';
    }

    // Generic family detection (fallback - MUST match backend)
    if (normalized.includes('haiku')) {
      return 'claude-haiku-4-5'; // Default to latest
    }
    if (normalized.includes('opus')) {
      return 'claude-opus-4-7'; // Default to latest
    }
    if (normalized.includes('sonnet')) {
      return 'claude-sonnet-4-6'; // Default to latest
    }

    // Unknown model - return original
    console.warn(`[TokenCounter] Unknown model: '${model}'. Using default pricing.`);
    return model;
  }

  /**
   * 浣跨敤瀹樻柟API璁＄畻token鏁伴噺
   */
  async countTokens(
    messages: ClaudeMessage[],
    model?: string,
    tools?: ClaudeTool[],
    systemPrompt?: string
  ): Promise<TokenCountResponse> {
    const normalizedModel = this.normalizeModel(model);

    // 濡傛灉瀹㈡埛绔笉鍙敤锛屼娇鐢ㄤ及绠楁柟娉?    if (!this.client) {
    if (!this.client) {
      return this.estimateTokens(messages, tools, systemPrompt);
    }

    try {
      const requestData: any = {
        model: normalizedModel,
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
      };

      if (tools && tools.length > 0) {
        requestData.tools = tools;
      }

      if (systemPrompt) {
        requestData.system = systemPrompt;
      }

      const response = await this.client.messages.countTokens(requestData);

      return {
        input_tokens: response.input_tokens,
        cache_creation_input_tokens: (response as any).cache_creation_input_tokens,
        cache_read_input_tokens: (response as any).cache_read_input_tokens,
      };
    } catch (error) {
      console.warn('[TokenCounter] API璋冪敤澶辫触锛屼娇鐢ㄤ及绠楁柟娉?', error);
      return this.estimateTokens(messages, tools, systemPrompt);
    }
  }

  /**
   * 闄嶇骇浼扮畻鏂规硶锛堝綋API涓嶅彲鐢ㄦ椂锛?   */
  private estimateTokens(
    messages: ClaudeMessage[],
    tools?: ClaudeTool[],
    systemPrompt?: string
  ): TokenCountResponse {
    let totalTokens = 0;

    // 浼扮畻娑堟伅token
    for (const message of messages) {
      if (typeof message.content === 'string') {
        totalTokens += Math.ceil(message.content.length / 4); // 绮楃暐浼扮畻锛?瀛楃=1token
      } else if (Array.isArray(message.content)) {
        for (const content of message.content) {
          if (content.type === 'text' && content.text) {
            totalTokens += Math.ceil(content.text.length / 4);
          } else if (content.type === 'image') {
            totalTokens += 1551; // 鍩轰簬瀹樻柟鏂囨。鐨勫浘鍍弔oken浼扮畻
          } else if (content.type === 'document') {
            totalTokens += 2188; // 鍩轰簬瀹樻柟鏂囨。鐨凱DF token浼扮畻
          }
        }
      }
    }

    // 浼扮畻绯荤粺鎻愮ずtoken
    if (systemPrompt) {
      totalTokens += Math.ceil(systemPrompt.length / 4);
    }

    // 浼扮畻宸ュ叿瀹氫箟token
    if (tools && tools.length > 0) {
      const toolsJson = JSON.stringify(tools);
      totalTokens += Math.ceil(toolsJson.length / 4);
    }

    return {
      input_tokens: totalTokens,
    };
  }

  /**
   * 鎵归噺璁＄畻token锛堝苟琛屽鐞嗭級
   */
  async batchCountTokens(
    requests: Array<{
      messages: ClaudeMessage[];
      model?: string;
      tools?: ClaudeTool[];
      systemPrompt?: string;
    }>
  ): Promise<TokenCountResponse[]> {
    try {
      const promises = requests.map(req =>
        this.countTokens(req.messages, req.model, req.tools, req.systemPrompt)
      );
      return await Promise.all(promises);
    } catch (error) {
      console.error('[TokenCounter] 鎵归噺璁＄畻澶辫触:', error);
      // 闄嶇骇鍒伴€愪釜璁＄畻
      const results: TokenCountResponse[] = [];
      for (const req of requests) {
        try {
          const result = await this.countTokens(req.messages, req.model, req.tools, req.systemPrompt);
          results.push(result);
        } catch (err) {
          results.push({ input_tokens: 0 });
        }
      }
      return results;
    }
  }

  /**
   * 璁＄畻鎴愭湰
   */
  calculateCost(usage: TokenUsage, model?: string): CostBreakdown {
    const normalizedModel = this.normalizeModel(model);
    const pricing = CLAUDE_PRICING[normalizedModel as keyof typeof CLAUDE_PRICING];

    if (!pricing) {
      console.warn(`[TokenCounter] 鏈煡妯″瀷瀹氫环: ${normalizedModel}`);
      return {
        input_cost: 0,
        output_cost: 0,
        cache_write_cost: 0,
        cache_read_cost: 0,
        total_cost: 0,
        total: 0, // 鍚戝悗鍏煎瀛楁
      };
    }

    const input_tokens = usage.input_tokens || 0;
    const output_tokens = usage.output_tokens || 0;
    const cache_write_tokens = usage.cache_creation_input_tokens || usage.cache_creation_tokens || 0;
    const cache_read_tokens = usage.cache_read_input_tokens || usage.cache_read_tokens || 0;

    const input_cost = (input_tokens * pricing.input) / 1_000_000;
    const output_cost = (output_tokens * pricing.output) / 1_000_000;
    const cache_write_cost = (cache_write_tokens * pricing.cache_write) / 1_000_000;
    const cache_read_cost = (cache_read_tokens * pricing.cache_read) / 1_000_000;

    const total_cost = input_cost + output_cost + cache_write_cost + cache_read_cost;
    return {
      input_cost,
      output_cost,
      cache_write_cost,
      cache_read_cost,
      total_cost,
      total: total_cost, // 鍚戝悗鍏煎瀛楁
    };
  }

  /**
   * 鑾峰彇璇︾粏鐨則oken鏄庣粏鍒嗘瀽
   */
  calculateBreakdown(usage: TokenUsage, model?: string): TokenBreakdown {
    const normalized = this.normalizeUsage(usage);
    const cost = this.calculateCost(normalized, model);

    const total = normalized.input_tokens + normalized.output_tokens +
                 (normalized.cache_creation_tokens || 0) + (normalized.cache_read_tokens || 0);

    const cache_hit_rate = total > 0 ? ((normalized.cache_read_tokens || 0) / total) * 100 : 0;

    // 璁＄畻缂撳瓨鑺傜害鐨勬垚鏈?    const standard_cost = ((normalized.cache_read_tokens || 0) *
    const standard_cost = ((normalized.cache_read_tokens || 0) *
                          (CLAUDE_PRICING[this.normalizeModel(model) as keyof typeof CLAUDE_PRICING]?.input || 3)) / 1_000_000;
    const actual_cache_cost = cost.cache_read_cost;
    const cost_savings = standard_cost - actual_cache_cost;

    return {
      total,
      input: normalized.input_tokens,
      output: normalized.output_tokens,
      cache_write: normalized.cache_creation_tokens || 0,
      cache_read: normalized.cache_read_tokens || 0,
      cost,
      efficiency: {
        cache_hit_rate,
        cost_savings,
      },
    };
  }

  /**
   * 鏍囧噯鍖杢oken浣跨敤鏁版嵁
   *
   * 鈿狅笍 This method now delegates to tokenExtractor.ts for unified token normalization.
   * All token standardization logic is centralized in tokenExtractor.ts
   */
  normalizeUsage(usage: TokenUsage): Required<TokenUsage> {
    // Import from tokenExtractor for unified normalization
    const { normalizeRawUsage } = require('./tokenExtractor');
    const standardized = normalizeRawUsage(usage);

    // Return in the expected TokenUsage format
    return {
      input_tokens: standardized.input_tokens,
      output_tokens: standardized.output_tokens,
      cache_creation_input_tokens: standardized.cache_creation_tokens,
      cache_creation_tokens: standardized.cache_creation_tokens,
      cache_read_input_tokens: standardized.cache_read_tokens,
      cache_read_tokens: standardized.cache_read_tokens,
    };
  }

  /**
   * 鏍煎紡鍖杢oken鏁伴噺鏄剧ず
   */
  formatCount(count: number): string {
    if (count >= 1_000_000) {
      return `${(count / 1_000_000).toFixed(2)}M`;
    } else if (count >= 1_000) {
      return `${(count / 1_000).toFixed(1)}K`;
    }
    return count.toLocaleString();
  }

  /**
   * 鏍煎紡鍖栨垚鏈樉绀?   */
  formatCost(cost: number): string {
    if (cost >= 1) {
      return `$${cost.toFixed(2)}`;
    } else if (cost >= 0.01) {
      return `$${cost.toFixed(3)}`;
    } else if (cost >= 0.001) {
      return `$${cost.toFixed(4)}`;
    } else if (cost > 0) {
      return `$${cost.toFixed(6)}`;
    }
    return '$0.00';
  }

  /**
   * 鏍煎紡鍖杢oken鏄庣粏鏄剧ず
   */
  formatBreakdown(
    usage: TokenUsage,
    model?: string,
    options: {
      compact?: boolean;
      includeCost?: boolean;
      includeEfficiency?: boolean
    } = {}
  ): string {
    const breakdown = this.calculateBreakdown(usage, model);

    if (options.compact) {
      const parts: string[] = [];

      if (breakdown.input > 0) parts.push(`${this.formatCount(breakdown.input)} in`);
      if (breakdown.output > 0) parts.push(`${this.formatCount(breakdown.output)} out`);
      if (breakdown.cache_read > 0) parts.push(`${this.formatCount(breakdown.cache_read)} read`);

      let result = parts.join(', ');

      if (options.includeCost && breakdown.cost.total_cost > 0) {
        result += ` 鈥?${this.formatCost(breakdown.cost.total_cost)}`;
      }

      if (options.includeEfficiency && breakdown.efficiency.cache_hit_rate > 0) {
        result += ` (${breakdown.efficiency.cache_hit_rate.toFixed(1)}% cached)`;
      }

      return result || `${this.formatCount(breakdown.total)} tokens`;
    }

    return `${this.formatCount(breakdown.total)} tokens`;
  }

  /**
   * 鍒涘缓璇︾粏鐨勫伐鍏锋彁绀哄唴瀹?   */
  createTooltip(usage: TokenUsage, model?: string): string {
    const breakdown = this.calculateBreakdown(usage, model);
    const normalizedModel = this.normalizeModel(model);
    const pricing = CLAUDE_PRICING[normalizedModel as keyof typeof CLAUDE_PRICING];

    const lines: string[] = [];

    lines.push(`妯″瀷: ${normalizedModel}`);
    lines.push(`鎬籘oken: ${breakdown.total.toLocaleString()}`);
    lines.push('');

    // Token鏄庣粏
    if (breakdown.input > 0) {
      lines.push(`杈撳叆Token: ${breakdown.input.toLocaleString()}`);
    }
    if (breakdown.output > 0) {
      lines.push(`杈撳嚭Token: ${breakdown.output.toLocaleString()}`);
    }
    if (breakdown.cache_write > 0) {
      lines.push(`缂撳瓨鍐欏叆: ${breakdown.cache_write.toLocaleString()}`);
    }
    if (breakdown.cache_read > 0) {
      lines.push(`缂撳瓨璇诲彇: ${breakdown.cache_read.toLocaleString()}`);
    }

    // 鎴愭湰鏄庣粏
    if (breakdown.cost.total_cost > 0) {
      lines.push('');
      lines.push(`鎬绘垚鏈? ${this.formatCost(breakdown.cost.total_cost)}`);

      if (breakdown.cost.input_cost > 0) {
        lines.push(`杈撳叆鎴愭湰: ${this.formatCost(breakdown.cost.input_cost)}`);
      }
      if (breakdown.cost.output_cost > 0) {
        lines.push(`杈撳嚭鎴愭湰: ${this.formatCost(breakdown.cost.output_cost)}`);
      }
      if (breakdown.cost.cache_write_cost > 0) {
        lines.push(`缂撳瓨鍐欏叆鎴愭湰: ${this.formatCost(breakdown.cost.cache_write_cost)}`);
      }
      if (breakdown.cost.cache_read_cost > 0) {
        lines.push(`缂撳瓨璇诲彇鎴愭湰: ${this.formatCost(breakdown.cost.cache_read_cost)}`);
      }
    }

    // 鏁堢巼鎸囨爣
    if (breakdown.efficiency.cache_hit_rate > 0) {
      lines.push('');
      lines.push(`缂撳瓨鍛戒腑鐜? ${breakdown.efficiency.cache_hit_rate.toFixed(1)}%`);
      if (breakdown.efficiency.cost_savings > 0) {
        lines.push(`鎴愭湰鑺傜害: ${this.formatCost(breakdown.efficiency.cost_savings)}`);
      }
    }

    // 瀹氫环淇℃伅
    if (pricing) {
      lines.push('');
      lines.push('瀹氫环 (姣忕櫨涓噒oken):');
      lines.push(`杈撳叆: $${pricing.input}`);
      lines.push(`杈撳嚭: $${pricing.output}`);
      lines.push(`缂撳瓨鍐欏叆: $${pricing.cache_write}`);
      lines.push(`缂撳瓨璇诲彇: $${pricing.cache_read}`);
    }

    return lines.join('\n');
  }

  /**
   * 鑾峰彇鏀寔鐨勬ā鍨嬪垪琛?   */
  getSupportedModels(): string[] {
    return Object.keys(CLAUDE_PRICING);
  }

  /**
   * 鑱氬悎澶氫釜token浣跨敤鏁版嵁
   */
  aggregateUsage(usages: TokenUsage[]): TokenUsage {
    return usages.reduce(
      (total, usage) => {
        const normalized = this.normalizeUsage(usage);
        return {
          input_tokens: (total.input_tokens || 0) + (normalized.input_tokens || 0),
          output_tokens: (total.output_tokens || 0) + (normalized.output_tokens || 0),
          cache_creation_tokens: (total.cache_creation_tokens || 0) + (normalized.cache_creation_tokens || 0),
          cache_read_tokens: (total.cache_read_tokens || 0) + (normalized.cache_read_tokens || 0),
          cache_creation_input_tokens: (total.cache_creation_input_tokens || 0) + (normalized.cache_creation_input_tokens || 0),
          cache_read_input_tokens: (total.cache_read_input_tokens || 0) + (normalized.cache_read_input_tokens || 0),
        };
      },
      { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    );
  }

  /**
   * 妫€鏌PI鏄惁鍙敤
   */
  isApiAvailable(): boolean {
    return this.client !== null;
  }
}

/**
 * Session-level token statistics
 */
export interface SessionTokenStats {
  total_tokens: number;
  total_cost: number;
  message_count: number;
  average_tokens_per_message: number;
  cache_efficiency: number;
  breakdown: TokenBreakdown;
  trend: {
    tokens_per_hour: number;
    cost_per_hour: number;
    peak_usage_time?: string;
  };
}

// 瀵煎嚭鍗曚緥瀹炰緥
export const tokenCounter = new TokenCounterService();

// 渚垮埄鍑芥暟瀵煎嚭
export const countTokens = (messages: ClaudeMessage[], model?: string, tools?: ClaudeTool[], systemPrompt?: string) =>
  tokenCounter.countTokens(messages, model, tools, systemPrompt);

export const calculateCost = (usage: TokenUsage, model?: string) =>
  tokenCounter.calculateCost(usage, model);

/**
 * 鍚戝悗鍏煎鐨勫嚱鏁颁繚鐣? * Normalize usage data from different API response formats
 */
export function normalizeTokenUsage(usage: any): TokenUsage {
  return tokenCounter.normalizeUsage(usage);
}

/**
 * 鍚戝悗鍏煎鐨勫嚱鏁颁繚鐣? * Get model pricing configuration
 */
export function getModelPricing(model?: string) {
  const normalizedModel = tokenCounter.normalizeModel(model);
  return CLAUDE_PRICING[normalizedModel as keyof typeof CLAUDE_PRICING] || CLAUDE_PRICING.default;
}

/**
 * Calculate detailed token breakdown with cost analysis
 */
export function calculateTokenBreakdown(
  usage: TokenUsage,
  model?: string
): TokenBreakdown {
  return tokenCounter.calculateBreakdown(usage, model);
}

/**
 * Format token count for display with appropriate units
 */
export function formatTokenCount(tokens: number): string {
  return tokenCounter.formatCount(tokens);
}

/**
 * Format cost for display with appropriate precision
 */
export function formatCost(cost: number): string {
  return tokenCounter.formatCost(cost);
}

/**
 * Create a detailed usage summary string
 */
export function formatUsageBreakdown(
  usage: TokenUsage,
  model?: string,
  options: {
    includeTotal?: boolean;
    includeCost?: boolean;
    includeEfficiency?: boolean;
    compact?: boolean;
  } = {}
): string {
  return tokenCounter.formatBreakdown(usage, model, {
    compact: options.compact,
    includeCost: options.includeCost,
    includeEfficiency: options.includeEfficiency
  });
}

/**
 * Create a detailed tooltip with comprehensive token information
 */
export function createTokenTooltip(
  usage: TokenUsage,
  model?: string
): string {
  return tokenCounter.createTooltip(usage, model);
}

/**
 * Aggregate tokens from multiple messages (e.g., for session totals)
 */
export function aggregateTokenUsage(usages: TokenUsage[]): TokenUsage {
  return usages.reduce(
    (total, usage) => {
      const normalized = normalizeTokenUsage(usage);
      return {
        input_tokens: (total.input_tokens || 0) + (normalized.input_tokens || 0),
        output_tokens: (total.output_tokens || 0) + (normalized.output_tokens || 0),
        cache_creation_tokens: (total.cache_creation_tokens || 0) + (normalized.cache_creation_tokens || 0),
        cache_read_tokens: (total.cache_read_tokens || 0) + (normalized.cache_read_tokens || 0),
      };
    },
    { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 }
  );
}

/**
 * Calculate session-level statistics with trends
 */
export function calculateSessionStats(
  messages: Array<{ usage?: any; timestamp?: string; receivedAt?: string }>,
  model?: string
): SessionTokenStats {
  // Extract valid usage data from messages
  const usages = messages
    .filter(msg => msg.usage)
    .map(msg => normalizeTokenUsage(msg.usage));

  if (usages.length === 0) {
    return {
      total_tokens: 0,
      total_cost: 0,
      message_count: messages.length,
      average_tokens_per_message: 0,
      cache_efficiency: 0,
      breakdown: calculateTokenBreakdown({ input_tokens: 0, output_tokens: 0 }, model),
      trend: {
        tokens_per_hour: 0,
        cost_per_hour: 0,
      }
    };
  }

  const aggregated = aggregateTokenUsage(usages);
  const breakdown = calculateTokenBreakdown(aggregated, model);

  // Calculate time-based trends
  const timestampedMessages = messages.filter(msg => msg.timestamp || msg.receivedAt);
  let tokensPerHour = 0;
  let costPerHour = 0;
  let peakUsageTime: string | undefined;

  if (timestampedMessages.length >= 2) {
    const firstTime = new Date(timestampedMessages[0].timestamp || timestampedMessages[0].receivedAt!);
    const lastTime = new Date(timestampedMessages[timestampedMessages.length - 1].timestamp || timestampedMessages[timestampedMessages.length - 1].receivedAt!);
    const hoursElapsed = (lastTime.getTime() - firstTime.getTime()) / (1000 * 60 * 60);

    if (hoursElapsed > 0) {
      tokensPerHour = breakdown.total / hoursElapsed;
      costPerHour = breakdown.cost.total_cost / hoursElapsed;
    }
  }

  return {
    total_tokens: breakdown.total,
    total_cost: breakdown.cost.total_cost,
    message_count: messages.length,
    average_tokens_per_message: breakdown.total / messages.length,
    cache_efficiency: breakdown.efficiency.cache_hit_rate,
    breakdown,
    trend: {
      tokens_per_hour: tokensPerHour,
      cost_per_hour: costPerHour,
      peak_usage_time: peakUsageTime,
    }
  };
}

/**
 * Get cached session token data from the API
 */
export async function getSessionCacheTokens(sessionId: string): Promise<{ cache_creation: number; cache_read: number }> {
  try {
    const cacheData = await api.getSessionCacheTokens(sessionId);
    return {
      cache_creation: cacheData.total_cache_creation_tokens,
      cache_read: cacheData.total_cache_read_tokens
    };
  } catch (error) {
    console.warn('Failed to fetch session cache tokens:', error);
    return { cache_creation: 0, cache_read: 0 };
  }
}

export default tokenCounter;

