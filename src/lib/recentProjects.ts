export type RecentProjectLike = {
  created_at: number;
};

export function prepareRecentProjects<T extends RecentProjectLike>(projects: readonly T[]): T[] {
  return [...projects].sort((a, b) => b.created_at - a.created_at);
}
