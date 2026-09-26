import useSWRInfinite from "swr/infinite";
import { GH_LIST_PAGE_SIZE, ghListIssues, ghListPrs } from "../../lib/api";
import type { GhIssue, GhListPage, GhPullRequest } from "../../lib/api-types";
import type { GitHubStateFilter, GitHubTab } from "../../lib/githubRoutes";
import { useInfiniteQueryInvalidation } from "../../lib/swr-cache";

function useGithubPagedList<T>(opts: {
  enabled: boolean;
  keyPrefix: string;
  fetcher: (
    fullName: string,
    filter: GitHubStateFilter,
    page: number,
  ) => Promise<GhListPage<T>>;
  repoFullName: string;
  currentFilter: GitHubStateFilter;
}) {
  const { enabled, keyPrefix, fetcher, repoFullName, currentFilter } = opts;
  const { data, error, isLoading, isValidating, size, setSize, mutate } =
    useSWRInfinite(
      (pageIndex, previousPageData: GhListPage<T> | null) => {
        if (!enabled || !repoFullName) return null;
        if (previousPageData && !previousPageData.hasMore) return null;
        return [keyPrefix, repoFullName, currentFilter, pageIndex + 1] as const;
      },
      ([, fullName, filter, page]) => fetcher(fullName, filter, page),
      { revalidateFirstPage: false },
    );
  useInfiniteQueryInvalidation([keyPrefix, repoFullName, currentFilter], () =>
    mutate(),
  );
  return {
    items: data?.flatMap((page) => page.items) ?? [],
    error: error as unknown,
    isLoading,
    fetchingNext: isValidating && size > 1,
    hasNextPage: Boolean(data?.at(-1)?.hasMore),
    fetchNext: () => setSize((s) => s + 1),
    refetch: mutate,
  };
}

const listIssues = (
  fullName: string,
  filter: GitHubStateFilter,
  page: number,
) => ghListIssues(fullName, filter, GH_LIST_PAGE_SIZE, page);

const listPrs = (fullName: string, filter: GitHubStateFilter, page: number) =>
  ghListPrs(fullName, filter, GH_LIST_PAGE_SIZE, page);

export function useGithubIssuePages(
  repoFullName: string,
  activeTab: GitHubTab,
  currentFilter: GitHubStateFilter,
) {
  return useGithubPagedList<GhIssue>({
    enabled: activeTab === "issues",
    keyPrefix: "gh-issues",
    fetcher: listIssues,
    repoFullName,
    currentFilter,
  });
}

export function useGithubPrPages(
  repoFullName: string,
  activeTab: GitHubTab,
  currentFilter: GitHubStateFilter,
) {
  return useGithubPagedList<GhPullRequest>({
    enabled: activeTab === "prs",
    keyPrefix: "gh-prs",
    fetcher: listPrs,
    repoFullName,
    currentFilter,
  });
}
