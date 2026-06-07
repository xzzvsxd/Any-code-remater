import { useEffect, useRef } from 'react';
import { useTabs } from './useTabs';
import { listen } from '@tauri-apps/api/event';
import { api } from '@/lib/api';

/**
 * useSessionSync - Hybrid session state sync (event-driven + fallback polling)
 *
 * Three-layer approach for reliable tab streaming state:
 * 1. Event-driven: Listen for claude-session-state events (real-time, <100ms)
 * 2. Initial sync: Check all running sessions on mount (catches missed events on startup)
 * 3. Periodic fallback: Re-check every 30 seconds (catches any missed events)
 *
 * This ensures tabs always show the correct running/idle state, even when:
 * - The app restarts while sessions are running
 * - Events are missed during tab switches
 * - Tabs are restored from localStorage with stale state
 */
export const useSessionSync = () => {
  const { tabs, updateTabStreamingStatus } = useTabs();

  // Use refs to avoid re-registering the listener on every tabs change
  const tabsRef = useRef(tabs);
  const updateTabStreamingStatusRef = useRef(updateTabStreamingStatus);

  // Keep refs up to date
  useEffect(() => {
    tabsRef.current = tabs;
    updateTabStreamingStatusRef.current = updateTabStreamingStatus;
  }, [tabs, updateTabStreamingStatus]);

  // Layer 2 & 3: Initial sync on mount + periodic fallback
  // Queries the backend for actually running sessions and reconciles with tab states
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    // 归一化路径：与 Layer 1 事件层保持一致，用于无 sessionId 新会话按 project_path 兜底比对。
    const normalizePath = (p?: string) =>
      p?.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '') || '';

    const syncRunningState = async () => {
      if (cancelled) return;

      // 空闲快速返回：无任何 streaming tab 时无需打扰后端。
      // 这样把周期间隔降到 8s 提速纠正的同时，空闲期几乎零开销（不发起 IPC）。
      const currentTabs = tabsRef.current;
      const hasStreamingTab = currentTabs.some((t) => t.state === 'streaming');
      if (!hasStreamingTab) return;

      try {
        const activeSessions = await api.listRunningClaudeSessions();
        if (cancelled) return;

        // 后端真实运行中的会话：同时建 sessionId 集合与 projectPath 集合。
        // projectPath 集合用于无 sessionId 的新会话兜底判断（拿到 id 前的运行窗口期）。
        const runningSessionIds = new Set<string>();
        const runningProjectPaths = new Set<string>();
        for (const s of activeSessions) {
          if ('process_type' in s && s.process_type && 'ClaudeSession' in s.process_type) {
            const sessionId = (s.process_type as any).ClaudeSession.session_id;
            if (sessionId) {
              runningSessionIds.add(sessionId);
            }
          }
          const projectPath = (s as any).project_path;
          if (projectPath) {
            runningProjectPaths.add(normalizePath(projectPath));
          }
        }

        // Reconcile tab states with actual running sessions
        for (const tab of currentTabs) {
          if (tab.session?.id) {
            // 已落盘/已拿到 sessionId 的会话：按 sessionId 精确对账。
            const isRunning = runningSessionIds.has(tab.session.id);
            if (isRunning && tab.state !== 'streaming') {
              // Session is running but tab shows idle -> correct to streaming
              console.debug('[SessionSync] Sync: marking tab as streaming:', tab.id, tab.session.id);
              updateTabStreamingStatusRef.current(tab.id, true, tab.session.id);
            } else if (!isRunning && tab.state === 'streaming') {
              // Session stopped but tab still shows streaming -> correct to idle
              console.debug('[SessionSync] Sync: marking tab as idle:', tab.id, tab.session.id);
              updateTabStreamingStatusRef.current(tab.id, false, null);
            }
            continue;
          }

          // 漏洞 A 修复：无 sessionId 但仍标记 streaming 的 tab —— 这只能是"新会话拿到 id 前的运行窗口期"。
          // 若该新会话在拿到 sessionId 前就异常终结（进程秒退 / init 失败 / 崩溃），tab.session 永远为空，
          // 旧逻辑（if (!tab.session?.id) continue）会永久跳过它 → 侧栏靠 tab.id 兜底的临时条目永久"运行中"。
          // 这里改为按 project_path 兜底判断：该项目路径下后端已无任何运行中的 Claude 会话 → 拨回 idle。
          if (tab.state === 'streaming') {
            const tabPath = normalizePath(tab.session?.project_path || tab.projectPath);
            // 无路径可判定时保守不动（交给事件层 / 下次对账），避免误杀真正刚起步、路径尚未就绪的会话。
            if (tabPath && !runningProjectPaths.has(tabPath)) {
              console.debug('[SessionSync] Sync: clearing stale streaming on session-less tab:', tab.id);
              updateTabStreamingStatusRef.current(tab.id, false, null);
            }
          }
        }
      } catch (error) {
        console.error('[SessionSync] Failed to sync running sessions:', error);
      }
    };

    // Initial sync after a short delay to let tabs be restored from localStorage
    const initialTimer = setTimeout(syncRunningState, 1000);

    // 漏洞 C 修复：周期对账间隔从 30s 降到 8s 提速纠正"虚假运行中"残留。
    // 配合 syncRunningState 内的"无 streaming tab 即快速返回"，空闲期不发起 IPC，提速不增空转开销。
    intervalId = setInterval(syncRunningState, 8000);

    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      if (intervalId) clearInterval(intervalId);
    };
  }, []); // Empty deps - only set up once

  // Layer 1: Event-driven real-time updates
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    // Listen to claude-session-state events
    const setupListener = async () => {
      try {
        unlisten = await listen<{
          session_id: string;
          status: 'started' | 'stopped';
          success?: boolean;
          error?: string;
          project_path?: string;
          model?: string;
          pid?: number;
          run_id?: number;
        }>('claude-session-state', (event) => {
          const { session_id, status, project_path } = event.payload;

          // Use multiple matching strategies to find the tab
          // 1. Match by session_id first (existing sessions)
          // 2. Fall back to project_path matching (new sessions where tab.session?.id is not yet set)
          const normalizePath = (p: string) => p?.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '') || '';

          let tab = tabsRef.current.find(t => t.session?.id === session_id);

          if (!tab && project_path) {
            const normalizedEventPath = normalizePath(project_path);
            // project_path 兜底匹配分两种意图：
            // - started：只允许匹配「已有 session 的 tab」，绝不匹配 type:'new' 的全新 tab，
            //   否则会把一个刚开的空白新 tab 误标成同项目下旧会话的 streaming（原 FIX 的初衷）。
            // - stopped（漏洞 B 修复）：必须允许匹配「无 session 但正处于 streaming 的新 tab」，
            //   这正是新会话拿到 sessionId 前异常终结的场景——若沿用 started 的排除规则，
            //   stopped 永远匹配不到它 → state 卡在 streaming → 侧栏临时条目永久"运行中"。
            tab = tabsRef.current.find(t => {
              const tabProjectPath = t.projectPath || t.session?.project_path;
              if (!tabProjectPath || normalizePath(tabProjectPath) !== normalizedEventPath) return false;
              if (status === 'stopped') {
                // 仅归零那些确实在 streaming 的 tab（无论是否已有 session），幂等且不误伤 idle tab。
                return t.state === 'streaming';
              }
              // started：维持原防护——跳过无 session 的新 tab。
              return !!t.session;
            });
          }

          if (tab) {
            if (status === 'started') {
              // Session started - set to streaming
              if (tab.state !== 'streaming') {
                updateTabStreamingStatusRef.current(tab.id, true, session_id);
              }
            } else if (status === 'stopped') {
              // Session stopped - set to idle
              if (tab.state === 'streaming') {
                updateTabStreamingStatusRef.current(tab.id, false, null);

                // If error occurred, log it
                if (event.payload.error) {
                  console.error(`[SessionSync] Session ${session_id} stopped with error:`, event.payload.error);
                }
              }
            }
          } else {
            console.warn(`[SessionSync] No tab found for session ${session_id}`);
          }
        });
      } catch (error) {
        console.error('[SessionSync] Failed to setup event listener:', error);
        // Fallback: Continue without real-time updates
        // The periodic sync will still keep tab states accurate
      }
    };

    setupListener();

    // Cleanup
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []); // Empty deps - listener only needs to be registered once
};
