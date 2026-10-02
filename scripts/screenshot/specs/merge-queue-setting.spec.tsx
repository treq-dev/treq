import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { SettingsPage } from "../../../src/components/SettingsPage";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { createTestRepo, openRepo } from "../../../test/utils";
import { captureDocument } from "../capture";

// The merge queue opt-in lives in Settings › Integrations and is stored in
// Postgres. Supabase and the repo's GitHub remote are stubbed (neither is
// reachable from the desktop harness); the settings page itself is real.
const { queueState, repoState, mockGetGitRemoteUrl, mockSetEnabled, auth } =
  vi.hoisted(() => ({
    queueState: { enabled: false },
    repoState: {
      repositories: [
        {
          id: 1,
          full_name: "treq-dev/treq",
          private: false,
          default_branch: "main",
          installation_id: 99,
        },
      ] as unknown[],
    },
    mockGetGitRemoteUrl: vi.fn(),
    mockSetEnabled: vi.fn(),
    // Stable identities are no longer required (the effect keys on user.id),
    // but a realistic useAuth returns a memoized object anyway.
    auth: {
      user: { id: "user-1" },
      session: { access_token: "token" },
      loading: false,
      subscription: { plan: "pro", status: "active" },
      signIn: vi.fn(),
    },
  }));

vi.mock("../../../src/lib/features", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/lib/features")>();
  return {
    ...actual,
    FEATURES: {
      ...actual.FEATURES,
      pro: true,
      stripePayments: false,
      emailSignup: false,
      mergeQueue: true,
    },
  };
});

vi.mock("../../../src/stores/authStore", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/stores/authStore")>();
  const { createAuthStoreMock } = await import(
    "../../../test/mocks/zustandAuthStore"
  );
  return { ...actual, useAuthStore: createAuthStoreMock(auth) };
});

vi.mock("../../../src/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(async (fn: string, args?: Record<string, unknown>) => {
      if (fn === "get_merge_queue_enabled") {
        return { data: queueState.enabled, error: null };
      }
      if (fn === "set_merge_queue_enabled") {
        mockSetEnabled(args);
        queueState.enabled = args?.p_enabled === true;
        return { data: queueState.enabled, error: null };
      }
      return { data: [], error: null };
    }),
    from: () => ({
      select: () =>
        Promise.resolve({ data: repoState.repositories, error: null }),
    }),
    functions: { invoke: vi.fn() },
  },
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_ANON_KEY: "anon",
  WEB_URL: "http://localhost:3000",
}));

vi.mock("../../../src/lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../src/lib/api")>(
    "../../../src/lib/api",
  );
  return { ...actual, getGitRemoteUrl: mockGetGitRemoteUrl };
});

const LINKED_REPO = {
  id: 1,
  full_name: "treq-dev/treq",
  private: false,
  default_branch: "main",
  installation_id: 99,
};

const REMOTE_INFO = {
  owner: "treq-dev",
  repo: "treq",
  full_name: "treq-dev/treq",
};

it("captures turning the merge queue on from Settings › Integrations", async () => {
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);
  mockGetGitRemoteUrl.mockResolvedValue(REMOTE_INFO);
  queueState.enabled = false;
  repoState.repositories = [LINKED_REPO];
  auth.subscription = { plan: "pro", status: "active" };
  mockSetEnabled.mockClear();

  const user = userEvent.setup();
  render(<SettingsPage repoPath={repoPath} onClose={vi.fn()} />);

  await user.click(await screen.findByRole("tab", { name: /integrations/i }));

  // Eligible repo, queue off: a CTA to switch it on, not a prompt.
  const section = await screen.findByTestId("merge-queue-setting");
  const cta = await within(section).findByRole("button", {
    name: /enable merge queue/i,
  });
  expect(
    within(section).queryByRole("switch", { name: /enable merge queue/i }),
  ).not.toBeInTheDocument();
  await captureDocument(document, {
    name: "merge-queue-setting-01-off",
    expectations: [
      'There is a single "GitHub" header with an icon and a rule under it -- no bordered cards anywhere on the page.',
      'Under that header, a "Merge queue" row reads "Merge branches automatically once CI passes." and a "Connected repositories" row sits below it, separated by a thin divider.',
      'The merge queue row\'s control is a primary "Enable merge queue" CTA button -- there is no toggle switch while it is off.',
    ],
  });

  await user.click(cta);

  const toggle = await within(section).findByRole("switch", {
    name: /enable merge queue/i,
  });
  await waitFor(() => {
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });
  expect(mockSetEnabled).toHaveBeenCalledWith(
    expect.objectContaining({
      p_repo_full_name: REMOTE_INFO.full_name,
      p_enabled: true,
    }),
  );
  await captureDocument(document, {
    name: "merge-queue-setting-02-on",
    expectations: [
      'The merge queue row now reads "Queued branches merge automatically once CI passes."',
      "Its control has become a toggle switch in the ON position (filled/primary, knob to the right) -- the CTA button is gone.",
      "No error text is shown.",
    ],
  });
}, 120000);

it("captures the merge queue setting for a repo the GitHub App is not on", async () => {
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);
  mockGetGitRemoteUrl.mockResolvedValue(REMOTE_INFO);
  queueState.enabled = false;
  // Signed in and on Pro, but this repo is not one of the installation's.
  repoState.repositories = [];
  auth.subscription = { plan: "pro", status: "active" };

  const user = userEvent.setup();
  render(<SettingsPage repoPath={repoPath} onClose={vi.fn()} />);

  await user.click(await screen.findByRole("tab", { name: /integrations/i }));
  const section = await screen.findByTestId("merge-queue-setting");

  await within(section).findByText(/install the treq github app/i);
  expect(
    within(section).queryByRole("button", { name: /enable merge queue/i }),
  ).not.toBeInTheDocument();
  expect(
    within(section).queryByRole("switch", { name: /enable merge queue/i }),
  ).not.toBeInTheDocument();
  await captureDocument(document, {
    name: "merge-queue-setting-03-not-eligible",
    expectations: [
      "The merge queue row explains that the Treq GitHub App must be installed on treq-dev/treq to use the merge queue.",
      "There is no Enable CTA and no toggle -- an ineligible repo gets the reason instead of a control that could only fail.",
    ],
  });
}, 120000);

it("offers an upgrade path instead of the CTA on a free plan", async () => {
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);
  mockGetGitRemoteUrl.mockResolvedValue(REMOTE_INFO);
  queueState.enabled = false;
  repoState.repositories = [LINKED_REPO];
  auth.subscription = { plan: "free", status: "active" };

  const user = userEvent.setup();
  render(<SettingsPage repoPath={repoPath} onClose={vi.fn()} />);

  await user.click(await screen.findByRole("tab", { name: /integrations/i }));
  const section = await screen.findByTestId("merge-queue-setting");

  await within(section).findByText(/upgrade to pro to use the merge queue/i);
  expect(
    within(section).getByRole("button", { name: /upgrade to pro/i }),
  ).toBeVisible();
  expect(
    within(section).queryByRole("button", { name: /enable merge queue/i }),
  ).not.toBeInTheDocument();
}, 120000);
