import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { WorkbenchSidebar } from "@/components/layout/WorkbenchSidebar";
import { useUpdate } from '@/contexts/UpdateContext';
import { message } from '@tauri-apps/plugin-dialog';
import { UpdateDialog } from '@/components/dialogs/UpdateDialog';
import { AboutDialog } from '@/components/dialogs/AboutDialog';

interface AppLayoutProps {
  children: ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const { checkUpdate, hasUpdate, updateInfo, isDismissed } = useUpdate();
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [showAboutDialog, setShowAboutDialog] = useState(false);
  const autoOpenedUpdateVersionRef = useRef<string | null>(null);
  const isDev = import.meta.env.DEV;

  useEffect(() => {
    const availableVersion = updateInfo?.availableVersion;
    if (!hasUpdate || !availableVersion || isDismissed) {
      return;
    }

    if (autoOpenedUpdateVersionRef.current === availableVersion) {
      return;
    }

    autoOpenedUpdateVersionRef.current = availableVersion;
    setShowUpdateDialog(true);
  }, [hasUpdate, isDismissed, updateInfo?.availableVersion]);

  const handleCheckUpdate = async () => {
    setShowAboutDialog(false);

    if (isDev) {
      await message('开发模式下已跳过更新检查', { title: '更新检查', kind: 'info' });
      return;
    }
    
    // 强制检查更新
    const hasUpdate = await checkUpdate(true);
    
    if (hasUpdate) {
      setShowUpdateDialog(true);
    } else {
      // 如果没有更新，显示提示
      await message('当前已是最新版本', { title: '检查更新', kind: 'info' });
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-background flex text-foreground selection:bg-primary/20 selection:text-primary relative">
      {/* ✨ Neo-Modern Fluid Background */}
      <div className="absolute inset-0 pointer-events-none z-0">
        {/* Noise Texture */}
        <div
          className="absolute inset-0 opacity-[0.015] dark:opacity-[0.03] mix-blend-overlay"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          }}
        />
        {/* Subtle Gradient Mesh */}
        <div className="absolute inset-0 opacity-30 dark:opacity-20 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background" />
      </div>

      {/* 单一工作台侧栏（合并了原图标导航栏）：项目树为主体 + 底部导航 dock，全视图常驻 */}
      <div className="z-50 flex-shrink-0 relative">
        <WorkbenchSidebar
          onAboutClick={() => setShowAboutDialog(true)}
          onUpdateClick={() => setShowUpdateDialog(true)}
        />
      </div>

      {/* Main Content Area */}
      <main className="flex-1 relative flex flex-col min-w-0 overflow-hidden z-10">
        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-none [overscroll-behavior-y:none] scroll-smooth">
          {children}
        </div>
      </main>

      {/* Global Dialogs */}
      <UpdateDialog open={showUpdateDialog} onClose={() => setShowUpdateDialog(false)} />

      <AboutDialog
        open={showAboutDialog}
        onClose={() => setShowAboutDialog(false)}
        onCheckUpdate={handleCheckUpdate}
      />
    </div>
  );
};
