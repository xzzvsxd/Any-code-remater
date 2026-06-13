import { useEffect, useRef } from 'react';
import { useTabs } from './useTabs';
import { listen } from '@tauri-apps/api/event';
import { api } from '@/lib/api';
import {
  collectRunningSessionUpdates,
  shouldQueryRunningSessions,
  type SessionSyncReason,
} from '@/lib/sessionSync';

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

    const syncRunningState = async (reason: SessionSyncReason) => {
      if (cancelled) return;

      const currentTabs = tabsRef.current;
      if (!shouldQueryRunningSessions(currentTabs, reason)) return;

      try {
        const activeSessions = await api.listRunningClaudeSessions();
        if (cancelled) return;

        for (const update of collectRunningSessionUpdates(currentTabs, activeSessions)) {
          console.debug('[SessionSync] Sync: applying running-state update:', update);
          updateTabStreamingStatusRef.current(
            update.tabId,
            update.isStreaming,
            update.sessionId,
          );
        }
      } catch (error) {
        console.error('[SessionSync] Failed to sync running sessions:', error);
      }
    };

    // Initial sync after a short delay to let tabs be restored from localStorage
    const initialTimer = setTimeout(() => syncRunningState('initial'), 1000);

    // 漏洞 C 修复：周期对账间隔从 30s 降到 8s 提速纠正"虚假运行中"残留。
    // 配合 syncRunningState 内的 periodic 快速返回，空闲期不发起 IPC，提速不增空转开销。
    intervalId = setInterval(() => syncRunningState('periodic'), 8000);

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
