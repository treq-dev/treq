import useSWRInfinite from "swr/infinite";
import { GH_LIST_PAGE_SIZE, ghListIssues, ghListPrs } from "../../lib/api";
import type { GhIssue, GhListPage, GhPullRequest } from "../../lib/api-types";
import type { GitHubStateFilter, GitHubTab } from "../../lib/githubRoutes";
import { useInfiniteQueryInvalidation } from "../../lib/swr-cache";

/** Issues page by `after` cursor; pull requests still page by number. */
interface PageRequest {
  fullName: string;
  filter: GitHubStateFilter;
  page: number;
  after: string | null;
}

/**
 * Pages are fetched at different times, so an item can shift from one page
 * into the next (for example, when an item is created or reopened between
 * requests) and come back twice. Keep the first copy.
 */
function uniqueByNumber<T extends { number: number }>(items: T[]): T[] {
  const seen = new Set<number>();
  return items.filter((item) => {
    if (seen.has(item.number)) return false;
    seen.add(item.number);
    return true;
  });
}

function useGithubPagedList<T extends { number: number }>(opts: {
  enabled: boolean;
  keyPrefix: string;
  fetcher: (request: PageRequest) => Promise<GhListPage<T>>;
  repoFullName: string;
  currentFilter: GitHubStateFilter;
}) {
  const { enabled, keyPrefix, fetcher, repoFullName, currentFilter } = opts;
  const { data, error, isLoading, isValidating, size, setSize, mutate } =
    useSWRInfinite(
      (pageIndex, previousPageData: GhListPage<T> | null) => {
        if (!enabled || !repoFullName) return null;
        if (previousPageData && !previousPageData.hasMore) return null;
        return [
          keyPrefix,
          repoFullName,
          currentFilter,
          pageIndex + 1,
          previousPageData?.endCursor ?? null,
        ] as const;
      },
      ([, fullName, filter, page, after]) =>
        fetcher({ fullName, filter, page, after }),
      { revalidateFirstPage: false },
    );
  useInfiniteQueryInvalidation([keyPrefix, repoFullName, currentFilter], () =>
    mutate(),
  );
  return {
    items: uniqueByNumber(data?.flatMap((page) => page.items) ?? []),
    error: error as unknown,
    isLoading,
    fetchingNext: isValidating && size > 1,
    hasNextPage: Boolean(data?.at(-1)?.hasMore),
    fetchNext: () => setSize((s) => s + 1),
    refetch: mutate,
  };
}

const listIssues = ({ fullName, filter, after }: PageRequest) =>
  ghListIssues(fullName, filter, GH_LIST_PAGE_SIZE, after);

const listPrs = ({ fullName, filter, page }: PageRequest) =>
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
