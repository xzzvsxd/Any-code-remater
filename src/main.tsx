import "./lib/browserCompatBoot";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import "./assets/shimmer.css";
import "./styles.css";
import "./i18n"; // ✅ i18n 必须同步加载（App 立即需要使用）
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isSessionWindow } from "./lib/windowManager";
import { initializeToolRegistry } from "./lib/toolRegistryInit";

// 工具渲染器必须在首帧渲染前注册。
// 之前异步初始化会导致会话消息先渲染，toolRegistry 暂时为空，update_plan /
// request_user_input 等已知工具退化成 raw JSON；注册完成后 registry 又不是
// React state，不会触发已渲染消息重绘，用户就会一直看到 JSON。
try {
  initializeToolRegistry();
} catch (error) {
  console.error('[main] ToolRegistry initialization failed:', error);
}

// 🆕 懒加载 SessionWindow 组件（仅在需要时加载）
const SessionWindow = React.lazy(() => import('./pages/SessionWindow'));

// 防止窗口闪烁的React包装组件
const AppWrapper: React.FC = () => {
  // 🆕 检测是否为独立会话窗口
  const isDetachedWindow = isSessionWindow();

  React.useEffect(() => {
    // 在React应用完全挂载后显示窗口
    const showWindow = async () => {
      try {
        const window = getCurrentWindow();
        await window.show();
        await window.setFocus();
      } catch (error) {
        console.error('Failed to show window:', error);
      }
    };

    // 立即显示窗口（生产模式已优化，不需要长延迟）
    const timer = setTimeout(showWindow, 50);
    return () => clearTimeout(timer);
  }, []);

  // 🆕 根据窗口类型渲染不同的组件
  if (isDetachedWindow) {
    return (
      <ErrorBoundary onError={(error, errorInfo) => {
        console.error('[DetachedWindow] Render error:', error, errorInfo);
      }}>
        <ThemeProvider>
          <React.Suspense
            fallback={
              <div className="h-screen w-screen flex items-center justify-center bg-background">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            }
          >
            <SessionWindow />
          </React.Suspense>
        </ThemeProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary onError={(error, errorInfo) => {
      console.error('[App] Render error:', error, errorInfo);
    }}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  );
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppWrapper />
  </React.StrictMode>,
);
