import { useState, useEffect } from "react";
import { Info, RefreshCw, ExternalLink } from "lucide-react";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { getVersion } from "@tauri-apps/api/app";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";
import {
  getCopyrightYear,
  PROJECT_RELEASES_URL,
  UPSTREAM_PROJECTS,
} from "@/lib/appMetadata";

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
  onCheckUpdate: () => void;
}

export function AboutDialog({ open, onClose, onCheckUpdate }: AboutDialogProps) {
  const { t } = useTranslation();
  const [appVersion, setAppVersion] = useState<string>(t('messages.loading'));
  const copyrightYear = getCopyrightYear();

  // 动态获取应用版本号
  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const version = await getVersion();
        setAppVersion(version);
      } catch (err) {
        console.error("Failed to get version:", err);
        setAppVersion(t('dialogs.unknown'));
      }
    };

    if (open) {
      fetchVersion();
    }
  }, [open, t]);

  const handleOpenExternal = async (url: string) => {
    try {
      await openUrl(url);
    } catch (err) {
      console.error(t('dialogs.openProjectPageFailed'), err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center sm:text-center">
          <div className="mx-auto mb-4 inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10">
            <Info className="w-8 h-8 text-primary" />
          </div>
          <DialogTitle className="text-xl">Any Code</DialogTitle>
          <DialogDescription className="flex items-center justify-center gap-2">
            <span>{t('about.version')}:</span>
            <span className="font-mono font-semibold text-primary">
              v{appVersion}
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* Description */}
        <div className="p-4 bg-muted/50 rounded-lg">
          <p className="text-sm text-muted-foreground text-center">
            {t('about.description')}
          </p>
        </div>

        {/* Actions */}
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            variant="secondary"
            onClick={onCheckUpdate}
            className="w-full"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            {t('about.checkUpdate')}
          </Button>

          <Button
            variant="outline"
            onClick={() => void handleOpenExternal(PROJECT_RELEASES_URL)}
            className="w-full"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            {t('about.visitProject')}
          </Button>
        </DialogFooter>

        <div className="pt-4 border-t border-border text-center">
          <p className="text-xs font-medium text-foreground">
            {t('about.originalAuthors')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('about.originalAuthorsDescription')}
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1">
            {UPSTREAM_PROJECTS.map((project) => (
              <a
                key={project.url}
                href={project.url}
                onClick={(event) => {
                  event.preventDefault();
                  void handleOpenExternal(project.url);
                }}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>{project.name}</span>
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-border text-center">
          <p className="text-xs text-muted-foreground">
            © {copyrightYear} Any Code. All rights reserved.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
