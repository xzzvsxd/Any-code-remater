import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FolderOpen,
  FileText,
  Settings,
  MoreVertical,
  Trash2,
  Archive,
  LayoutGrid,
  List
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Project } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatAbsoluteDateTime } from "@/lib/date-utils";
import { Pagination } from "@/components/ui/pagination";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DeletedProjects } from "./DeletedProjects";
import { ProjectListSkeleton } from "@/components/skeletons/ProjectListSkeleton";

interface ProjectListProps {
  /**
   * Array of projects to display
   */
  projects: Project[];
  /**
   * Callback when a project is clicked
   */
  onProjectClick: (project: Project) => void;
  /**
   * Callback when hooks configuration is clicked
   */
  onProjectSettings?: (project: Project) => void;
  /**
   * Callback when a project is deleted
   */
  onProjectDelete?: (project: Project) => Promise<void>;
  /**
   * Callback when projects are changed (for refresh)
   */
  onProjectsChanged?: () => void;
  /**
   * Whether the list is currently loading
   */
  loading?: boolean;
  /**
   * Optional className for styling
   */
  className?: string;
}

const ITEMS_PER_PAGE = 12;

const normalizePath = (path: string) =>
  path ? path.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() : '';

/**
 * Extracts the project name from the full path
 * Handles both Windows (\) and Unix (/) path separators
 */
const getProjectName = (path: string): string => {
  if (!path) return 'Unknown Project';
  
  // Normalize path separators and split
  const normalizedPath = path.replace(/\\/g, '/');
  const parts = normalizedPath.split('/').filter(Boolean);
  
  // Get the last non-empty part (directory name)
  const projectName = parts[parts.length - 1];
  
  // Fallback to the original path if we can't extract a name
  return projectName || path;
};

/**
 * ProjectList component - Displays a paginated list of projects with hover animations
 * 
 * @example
 * <ProjectList
 *   projects={projects}
 *   onProjectClick={(project) => console.log('Selected:', project)}
 * />
 */
export const ProjectList: React.FC<ProjectListProps> = ({
  projects,
  onProjectClick,
  onProjectSettings,
  onProjectDelete,
  onProjectsChanged,
  loading,
  className,
}) => {
  const { t } = useTranslation();
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState("active");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  
  // Calculate pagination
  const totalPages = Math.ceil(projects.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentProjects = projects.slice(startIndex, endIndex);

  // Reset to page 1 if projects change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [projects.length]);

  const handleDeleteProject = (project: Project) => {
    setProjectToDelete(project);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!projectToDelete || !onProjectDelete) return;
    
    setIsDeleting(true);
    try {
      await onProjectDelete(projectToDelete);
      setDeleteDialogOpen(false);
      setProjectToDelete(null);
    } catch (error) {
      console.error('Failed to delete project:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const cancelDelete = () => {
    setDeleteDialogOpen(false);
    setProjectToDelete(null);
  };

  const sessionCountByPath = useMemo(() => {
    const counts = new Map<string, number>();
    projects.forEach(project => {
      counts.set(normalizePath(project.path), project.sessions.length);
    });
    return counts;
  }, [projects]);

  const ProjectGrid = () => {
    if (loading && projects.length === 0) {
      return <ProjectListSkeleton />;
    }

    return (
    <div className="space-y-4">
      <div className="flex justify-end mb-2">
        <div className="flex items-center bg-muted/50 rounded-lg p-1">
          <Button
            variant={viewMode === "grid" ? "secondary" : "ghost"}
            size="icon-sm"
            onClick={() => setViewMode("grid")}
            className="h-7 w-7"
            title={t('projectList.gridView')}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="icon-sm"
            onClick={() => setViewMode("list")}
            className="h-7 w-7"
            title={t('projectList.listView')}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "grid gap-3",
          viewMode === "grid"
            ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
            : "grid-cols-1"
        )}
        role="list"
        aria-label={t('projectList.projectListLabel')}
      >
        {currentProjects.map((project) => {
          const projectName = getProjectName(project.path);
          const sessionCount = sessionCountByPath.get(normalizePath(project.path)) ?? project.sessions.length;

          return (
            <div
              key={project.id}
              role="listitem"
              tabIndex={0}
              onClick={() => onProjectClick(project)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onProjectClick(project);
                }
              }}
              className={cn(
                "w-full text-left rounded-xl border transition-all duration-300 group cursor-pointer relative overflow-hidden",
                "bg-card hover:bg-gradient-to-br hover:from-card hover:to-muted/30",
                "border-border/40 hover:border-primary/30",
                "shadow-sm hover:shadow-lg hover:shadow-primary/5",
                viewMode === "grid" ? "p-5" : "px-4 py-3 flex items-center gap-4"
              )}
              aria-label={t('projectList.projectLabel', { projectName, sessionCount, createdAt: formatAbsoluteDateTime(project.created_at) })}
            >
              {/* 主要信息区：项目图标 + 项目名称 */}
              <div className={cn("flex items-start gap-4", viewMode === "grid" ? "mb-3" : "flex-1 items-center mb-0")}>
                <div className={cn(
                  "flex items-center justify-center rounded-xl transition-colors duration-300",
                  "bg-gradient-to-br from-primary/10 to-primary/5 text-primary group-hover:from-primary/20 group-hover:to-primary/10",
                  viewMode === "grid" ? "w-12 h-12" : "w-10 h-10 shrink-0"
                )}>
                  <FolderOpen className={cn("transition-transform duration-300 group-hover:scale-110", viewMode === "grid" ? "h-6 w-6" : "h-5 w-5")} aria-hidden="true" />
                </div>
                
                <div className={cn("min-w-0 flex flex-col justify-center", viewMode === "grid" ? "flex-1 pr-16" : "flex-1")}>
                  <h3 className="font-semibold text-base truncate text-foreground group-hover:text-primary transition-colors tracking-tight">
                    {projectName}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <p className={cn(
                      "text-xs text-muted-foreground/80 truncate font-mono bg-muted/50 px-1.5 py-0.5 rounded",
                      viewMode === "grid" ? "max-w-full" : "max-w-[200px]"
                    )}>
                      {viewMode === "grid" ? project.path : project.path}
                    </p>
                  </div>
                </div>
              </div>

              {/* 底部信息 (仅网格视图) */}
              {viewMode === "grid" && (
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/30">
                   <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                     <span className="w-1.5 h-1.5 rounded-full bg-green-500/50"></span>
                     {formatAbsoluteDateTime(project.created_at)}
                   </div>
                </div>
              )}

              {/* 列表视图的额外信息 */}
              {viewMode === "list" && (
                <div className="text-xs text-muted-foreground hidden md:flex items-center gap-2 w-40 justify-end">
                   {formatAbsoluteDateTime(project.created_at)}
                </div>
              )}

              {/* 右上角：会话数徽章 + 操作菜单 */}
              <div className={cn(
                "flex items-center gap-2",
                viewMode === "grid" ? "absolute top-5 right-4" : ""
              )}>
                {/* 会话数徽章 with Tooltip */}
                {sessionCount > 0 && (
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            "flex items-center gap-1.5 px-2.5 py-1 rounded-full cursor-default transition-all duration-300 border",
                            "bg-primary/5 text-primary border-primary/10 group-hover:bg-primary/10 group-hover:border-primary/20"
                          )}
                          aria-label={t('projectList.sessionCountAria', { count: sessionCount })}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                          <span className="text-sm font-semibold">{sessionCount}</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="p-0 border-primary/20 shadow-xl">
                        <div className="px-3 py-2 space-y-2 min-w-[150px]">
                          <p className="text-xs font-semibold text-foreground border-b border-border/50 pb-1.5">{t('projectList.sessionStats')}</p>
                          <div className="flex items-center justify-between text-xs group/item">
                            <span className="text-muted-foreground group-hover/item:text-foreground transition-colors">已索引会话</span>
                            <span className="font-mono bg-muted px-1.5 rounded text-[10px]">{sessionCount}</span>
                          </div>
                          <p className="text-[11px] leading-relaxed text-muted-foreground">
                            打开项目后会异步加载 Claude / Codex / Gemini 明细。
                          </p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}

                {/* 操作菜单 */}
                {(onProjectSettings || onProjectDelete) && (
                  <div className={cn(
                    "transition-all duration-200",
                    viewMode === "grid" ? "opacity-0 translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 group-focus-within:opacity-100 group-focus-within:translate-x-0" : "opacity-100"
                  )}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="h-8 w-8 hover:bg-muted"
                          aria-label={`${projectName} 项目操作菜单`}
                        >
                          <MoreVertical className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {onProjectSettings && (
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              onProjectSettings(project);
                            }}
                          >
                            <Settings className="h-4 w-4 mr-2" aria-hidden="true" />
                            {t('projectList.hooksConfig')}
                          </DropdownMenuItem>
                        )}
                        {onProjectSettings && onProjectDelete && (
                          <DropdownMenuSeparator />
                        )}
                        {onProjectDelete && (
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteProject(project);
                            }}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
                            {t('projectList.deleteProject')}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
      />
    </div>
  );
  };

  return (
    <div className={cn("space-y-4", className)}>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="active" className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4" />
            {t('projectList.activeProjects')}
          </TabsTrigger>
          <TabsTrigger value="deleted" className="flex items-center gap-2">
            <Archive className="h-4 w-4" />
            {t('projectList.deletedProjects')}
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="active" className="mt-6">
          <ProjectGrid />
        </TabsContent>
        
        <TabsContent value="deleted" className="mt-6">
          <DeletedProjects onProjectRestored={onProjectsChanged} />
        </TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('projectList.confirmDeleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('projectList.confirmDeleteDescription', { 
                projectName: projectToDelete ? getProjectName(projectToDelete.path) : "" 
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={cancelDelete}
              disabled={isDeleting}
            >
              {t('projectList.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? t('projectList.deleting') : t('projectList.confirmDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}; 
