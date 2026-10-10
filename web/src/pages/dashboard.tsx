import React, { useCallback, useEffect, useRef, useState } from "react";
import Layout from "@theme/Layout";
import Head from "@docusaurus/Head";
import BrowserOnly from "@docusaurus/BrowserOnly";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import type { StripeEmbeddedCheckout } from "@stripe/stripe-js";
import { loadStripe } from "@stripe/stripe-js/pure";
import { supabase } from "../lib/supabase";
import {
  GITHUB_APP_INSTALL_URL,
  STRIPE_PUBLISHABLE_KEY,
} from "../lib/constants";
import {
  fetchBillingPortalUrl,
  fetchCheckoutClientSecret,
} from "../lib/billing";
import {
  formatPeriodEnd,
  isProSubscription,
  subscriptionPeriodLabel,
  subscriptionStatusLabel,
  type Subscription,
} from "../lib/subscription";
import type { User, Session } from "@supabase/supabase-js";

interface GithubRepo {
  id: number;
  owner: string;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  installation_id: number;
}

interface MergeQueueConfig {
  id?: string;
  repo_id: number;
  target_branch: string;
  required_checks: string[];
  max_parallel_queues: number;
  batch_size: number;
  merge_method: "merge" | "squash" | "rebase";
  queue_trigger_label: string;
  delete_branch_on_merge: boolean;
  enabled: boolean;
}

interface QueueStatus {
  queue_id: string;
  target_branch: string;
  queued_count: number;
  testing_count: number;
  paused: boolean;
  bisect_mode: boolean;
}

type Tab = "subscription" | "integrations";

function defaultConfig(repoId: number, defaultBranch: string): MergeQueueConfig {
  return {
    repo_id: repoId,
    target_branch: defaultBranch,
    required_checks: [],
    max_parallel_queues: 1,
    batch_size: 5,
    merge_method: "squash",
    queue_trigger_label: "merge-queue",
    delete_branch_on_merge: true,
    enabled: true,
  };
}

// ── Repo config panel ────────────────────────────────────────────────────────

function RepoRow({ repo }: { repo: GithubRepo }) {
  return (
    <div style={styles.repoCard}>
      <div style={styles.repoHeader}>
        <div style={styles.repoMeta}>
          <span style={styles.repoName}>{repo.full_name}</span>
          {repo.private && <span style={styles.privateBadge}>private</span>}
        </div>
      </div>
    </div>
  );
}

function RepoConfigPanel({
  repo,
  onSave,
}: {
  repo: GithubRepo;
  onSave?: () => void;
}) {
  const [config, setConfig] = useState<MergeQueueConfig>(
    defaultConfig(repo.id, repo.default_branch)
  );
  const [queueStatus, setQueueStatus] = useState<QueueStatus[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    supabase
      .from("merge_queue_configs")
      .select("*")
      .eq("repo_id", repo.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setConfig(data as MergeQueueConfig);
      });

    supabase
      .rpc("get_repo_queue_status", { p_repo_id: repo.id })
      .then(({ data }) => {
        if (data) setQueueStatus(data as QueueStatus[]);
      });
  }, [repo.id]);

  const handleSave = async () => {
    setSaving(true);
    await supabase.from("merge_queue_configs").upsert(
      {
        ...config,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "repo_id,target_branch" }
    );
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onSave?.();
  };

  const totalQueued = queueStatus.reduce((s, q) => s + Number(q.queued_count), 0);
  const totalTesting = queueStatus.reduce((s, q) => s + Number(q.testing_count), 0);

  return (
    <div style={styles.repoCard}>
      <div
        style={styles.repoHeader}
        onClick={() => setExpanded((e) => !e)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setExpanded((x) => !x)}
      >
        <div style={styles.repoMeta}>
          <span style={styles.repoName}>{repo.full_name}</span>
          {repo.private && <span style={styles.privateBadge}>private</span>}
        </div>
        <div style={styles.repoStats}>
          {totalQueued > 0 && (
            <span style={styles.statBadge}>
              {totalQueued} queued
            </span>
          )}
          {totalTesting > 0 && (
            <span style={{ ...styles.statBadge, background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}>
              {totalTesting} testing
            </span>
          )}
          <span style={styles.chevron}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && (
        <div style={styles.configBody}>
          {/* Queue status */}
          {queueStatus.length > 0 && (
            <div style={styles.configSection}>
              <div style={styles.configLabel}>Active queues</div>
              {queueStatus.map((q) => (
                <div key={q.queue_id} style={styles.queueStatusRow}>
                  <span style={styles.branchPill}>→ {q.target_branch}</span>
                  <span style={styles.queueStatusText}>
                    {q.queued_count} queued · {q.testing_count} testing
                    {q.paused && " · paused"}
                    {q.bisect_mode && " · bisecting"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Config form */}
          <div style={styles.configSection}>
            <div style={styles.configRow}>
              <label style={styles.configLabel}>Target branch</label>
              <input
                style={styles.input}
                value={config.target_branch}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, target_branch: e.target.value }))
                }
                placeholder="main"
              />
            </div>

            <div style={styles.configRow}>
              <label style={styles.configLabel}>Trigger label</label>
              <input
                style={styles.input}
                value={config.queue_trigger_label}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, queue_trigger_label: e.target.value }))
                }
                placeholder="merge-queue"
              />
            </div>

            <div style={styles.configRow}>
              <label style={styles.configLabel}>Required CI checks</label>
              <input
                style={styles.input}
                value={config.required_checks.join(", ")}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    required_checks: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }))
                }
                placeholder="ci / test, ci / lint"
              />
              <div style={styles.inputHint}>Comma-separated check names</div>
            </div>

            <div style={styles.configRowInline}>
              <div style={{ flex: 1 }}>
                <label style={styles.configLabel}>Max parallel lanes</label>
                <input
                  style={{ ...styles.input, width: "80px" }}
                  type="number"
                  min={1}
                  max={10}
                  value={config.max_parallel_queues}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      max_parallel_queues: Math.max(1, Math.min(10, parseInt(e.target.value) || 1)),
                    }))
                  }
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={styles.configLabel}>Batch size</label>
                <input
                  style={{ ...styles.input, width: "80px" }}
                  type="number"
                  min={1}
                  max={20}
                  value={config.batch_size}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      batch_size: Math.max(1, Math.min(20, parseInt(e.target.value) || 1)),
                    }))
                  }
                />
              </div>
            </div>

            <div style={styles.configRow}>
              <label style={styles.configLabel}>Merge method</label>
              <select
                style={styles.select}
                value={config.merge_method}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    merge_method: e.target.value as "merge" | "squash" | "rebase",
                  }))
                }
              >
                <option value="squash">Squash and merge</option>
                <option value="merge">Merge commit</option>
                <option value="rebase">Rebase and merge</option>
              </select>
            </div>

            <div style={styles.configRowInline}>
              <label style={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={config.delete_branch_on_merge}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, delete_branch_on_merge: e.target.checked }))
                  }
                  style={{ marginRight: "0.5rem" }}
                />
                Delete branch after merge
              </label>
              <label style={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, enabled: e.target.checked }))
                  }
                  style={{ marginRight: "0.5rem" }}
                />
                Queue enabled
              </label>
            </div>
          </div>

          <div style={styles.configActions}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={styles.saveButton}
            >
              {saving ? "Saving…" : saved ? "Saved ✓" : "Save config"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Integrations tab ─────────────────────────────────────────────────────────

function IntegrationsTab() {
  const { siteConfig } = useDocusaurusContext();
  const flags = siteConfig.customFields?.featureFlags as
    | { githubApp?: boolean; mergeQueue?: boolean }
    | undefined;
  const githubAppEnabled = Boolean(flags?.githubApp);
  const mergeQueueEnabled = Boolean(flags?.mergeQueue);

  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [installError, setInstallError] = useState<string | null>(null);

  // Installation linking requires a server-created single-use intent; the
  // opaque state travels through GitHub's install flow back to our callback.
  const startInstall = useCallback(async () => {
    if (!githubAppEnabled) return;
    setInstallError(null);
    const { data, error } = await supabase.functions.invoke(
      "create-github-install-intent",
      { body: {} }
    );
    if (error || !data?.state) {
      setInstallError(error?.message ?? "Failed to start installation");
      return;
    }
    window.location.href = `${GITHUB_APP_INSTALL_URL}?state=${encodeURIComponent(data.state)}`;
  }, [githubAppEnabled]);

  const loadRepos = useCallback(async () => {
    setLoadingRepos(true);
    const { data } = await supabase
      .from("github_repositories")
      .select("*, github_app_installations!inner(linked_user_id)")
      .order("full_name");
    setRepos((data ?? []) as GithubRepo[]);
    setLoadingRepos(false);
  }, []);

  useEffect(() => {
    loadRepos();
  }, [loadRepos]);

  const isConnected = repos.length > 0;

  return (
    <div>
      <h2 style={styles.sectionTitle}>Integrations</h2>

      {/* GitHub App */}
      <div style={styles.card}>
        <div style={styles.integrationHeader}>
          <div style={styles.integrationInfo}>
            <div style={styles.integrationIcon}>
              <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
            </div>
            <div>
              <div style={styles.integrationName}>GitHub</div>
              <div style={styles.integrationDesc}>
                GitHub management powered by Treq.
              </div>
              <ul style={styles.integrationFeatureList}>
                <li>
                  <code>gh</code> CLI Integration
                </li>
                <li>Stacked PRs</li>
                <li>Issues and PR management</li>
                <li>
                  GitHub App Integration{" "}
                  <span style={styles.featureProBadge}>PRO</span>
                </li>
              </ul>
            </div>
          </div>
          <div style={styles.integrationActions}>
            {isConnected ? (
              <span style={styles.connectedBadge}>Connected</span>
            ) : (
              <div>
                <span
                  title={!githubAppEnabled ? "Coming Soon" : undefined}
                  style={
                    !githubAppEnabled
                      ? { display: "inline-block", cursor: "not-allowed" }
                      : undefined
                  }
                >
                  <button
                    type="button"
                    onClick={startInstall}
                    disabled={!githubAppEnabled}
                    style={{
                      ...styles.primaryButton,
                      border: "none",
                      ...(!githubAppEnabled
                        ? styles.primaryButtonDisabled
                        : { cursor: "pointer" }),
                    }}
                  >
                    Install GitHub App
                  </button>
                </span>
                {!githubAppEnabled && (
                  <div style={styles.comingSoonSubtext}>Coming Soon</div>
                )}
              </div>
            )}
          </div>
        </div>

        {installError && (
          <div style={{ color: "#ef4444", fontSize: "0.85rem", marginTop: "0.5rem" }}>
            {installError}
          </div>
        )}

        {isConnected && (
          <div style={styles.repoSection}>
            <div style={styles.repoSectionHeader}>
              <span style={styles.repoSectionTitle}>
                {repos.length} {repos.length === 1 ? "repository" : "repositories"}
              </span>
              {githubAppEnabled && (
                <a
                  href={GITHUB_APP_INSTALL_URL}
                  style={styles.manageLink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Manage access →
                </a>
              )}
            </div>
            {loadingRepos ? (
              <div style={styles.loadingText}>Loading repositories…</div>
            ) : (
              repos.map((repo) =>
                mergeQueueEnabled ? (
                  <RepoConfigPanel key={repo.id} repo={repo} />
                ) : (
                  <RepoRow key={repo.id} repo={repo} />
                )
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Subscription tab ─────────────────────────────────────────────────────────

// After embedded Checkout returns, Pro appears once the stripe-webhook
// function has recorded the subscription. Poll until then.
const CHECKOUT_RETURN_POLL_MS = 2000;
const CHECKOUT_RETURN_MAX_POLLS = 15;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      <div style={styles.fieldValue}>{children}</div>
    </div>
  );
}

// Mounts Stripe's embedded Checkout. Stripe.js loads only here, and asks
// billing-checkout for the session's client secret itself.
function EmbeddedCheckoutPanel({
  onError,
}: {
  onError: (message: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let checkout: StripeEmbeddedCheckout | null = null;
    loadStripe(STRIPE_PUBLISHABLE_KEY)
      .then((stripe) => {
        if (!stripe) throw new Error("Stripe failed to load");
        return stripe.initEmbeddedCheckout({
          fetchClientSecret: fetchCheckoutClientSecret,
        });
      })
      .then((instance) => {
        if (cancelled) {
          instance.destroy();
          return;
        }
        checkout = instance;
        if (container.current) instance.mount(container.current);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          onError(err instanceof Error ? err.message : "Could not start checkout");
        }
      });
    return () => {
      cancelled = true;
      checkout?.destroy();
    };
  }, [onError]);

  return (
    <div
      ref={container}
      data-testid="stripe-embedded-checkout"
      style={{ marginTop: "1.5rem" }}
    />
  );
}

function SubscriptionTab({
  subscription,
  reloadSubscription,
  stripePaymentsEnabled,
}: {
  subscription: Subscription | null;
  reloadSubscription: () => Promise<Subscription | null>;
  stripePaymentsEnabled: boolean;
}) {
  const isPro = isProSubscription(subscription);
  // Production builds open Checkout only once the live key is filled in.
  const checkoutAvailable = stripePaymentsEnabled && STRIPE_PUBLISHABLE_KEY !== "";

  const [billingCustomer, setBillingCustomer] = useState<
    { trial_used_at: string | null } | null | undefined
  >(undefined);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutReturn, setCheckoutReturn] = useState<
    "waiting" | "timed_out" | null
  >(() =>
    new URLSearchParams(window.location.search).has("session_id")
      ? "waiting"
      : null,
  );
  const [portalPending, setPortalPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("billing_customers")
      .select("trial_used_at")
      .maybeSingle()
      .then(({ data }) => setBillingCustomer(data ?? null));
  }, [isPro]);

  useEffect(() => {
    if (checkoutReturn !== "waiting") return;
    const finish = (outcome: "done" | "timed_out") => {
      const url = new URL(window.location.href);
      url.searchParams.delete("session_id");
      window.history.replaceState(null, "", url.toString());
      setCheckoutReturn(outcome === "done" ? null : "timed_out");
    };
    if (isPro) {
      finish("done");
      return;
    }
    let polls = 0;
    const timer = window.setInterval(() => {
      polls += 1;
      void reloadSubscription().then((latest) => {
        if (isProSubscription(latest)) return; // the isPro change finishes
        if (polls >= CHECKOUT_RETURN_MAX_POLLS) {
          window.clearInterval(timer);
          finish("timed_out");
        }
      });
    }, CHECKOUT_RETURN_POLL_MS);
    return () => window.clearInterval(timer);
  }, [checkoutReturn, isPro, reloadSubscription]);

  const onCheckoutError = useCallback((message: string) => {
    setCheckoutOpen(false);
    setError(message);
  }, []);

  const openPortal = async () => {
    setPortalPending(true);
    setError(null);
    try {
      window.location.href = await fetchBillingPortalUrl();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open billing management");
      setPortalPending(false);
    }
  };

  const trialEligible = !billingCustomer?.trial_used_at;
  const status = subscription?.status;
  const periodEnd = subscription?.current_period_end;

  return (
    <section aria-labelledby="subscription-heading">
      <h2 id="subscription-heading" style={styles.sectionTitle}>
        Subscription
      </h2>
      <div style={styles.card}>
        {checkoutReturn === "waiting" && (
          <div role="status" style={styles.notice}>
            Payment received. Activating Pro…
          </div>
        )}
        {checkoutReturn === "timed_out" && (
          <div role="status" style={styles.notice}>
            Payment received. Pro will appear here within a few minutes.
          </div>
        )}
        <Field label="Current Plan">
          <span style={isPro ? styles.proBadge : styles.freeBadge}>
            {isPro ? "Pro" : "Free"}
          </span>
        </Field>
        {isPro && status && (
          <Field label="Status">
            <span
              style={{
                color:
                  status === "active" || status === "trialing"
                    ? "#10b981"
                    : "#f59e0b",
              }}
            >
              {subscriptionStatusLabel(status)}
            </span>
          </Field>
        )}
        {isPro && status && periodEnd && (
          <Field label={subscriptionPeriodLabel(status)}>
            {formatPeriodEnd(periodEnd)}
          </Field>
        )}
        {isPro && status === "past_due" && (
          <p style={styles.billingNote}>
            Your last payment failed. Update your card in Manage billing to keep
            Pro.
          </p>
        )}
        {isPro && status === "canceled" && periodEnd && (
          <p style={styles.billingNote}>
            Your subscription is set to cancel. Pro stays on until{" "}
            {formatPeriodEnd(periodEnd)}.
          </p>
        )}

        <div style={styles.billingActions}>
          {!isPro && !checkoutOpen && (
            <div>
              <span
                title={!checkoutAvailable ? "Coming Soon" : undefined}
                style={
                  !checkoutAvailable
                    ? { display: "inline-block", cursor: "not-allowed" }
                    : undefined
                }
              >
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setCheckoutOpen(true);
                  }}
                  disabled={!checkoutAvailable}
                  style={{
                    ...styles.primaryButton,
                    ...(!checkoutAvailable ? styles.primaryButtonDisabled : {}),
                  }}
                >
                  {trialEligible ? "Start 14-day free trial" : "Upgrade to Pro"}
                </button>
              </span>
              {!checkoutAvailable && (
                <div style={styles.comingSoonSubtext}>Coming Soon</div>
              )}
            </div>
          )}
          {billingCustomer && (
            <button
              type="button"
              onClick={openPortal}
              disabled={portalPending}
              style={styles.secondaryButton}
            >
              Manage billing
            </button>
          )}
        </div>

        {error && (
          <div role="alert" style={styles.errorText}>
            {error}
          </div>
        )}

        {checkoutOpen && <EmbeddedCheckoutPanel onError={onCheckoutError} />}
      </div>
    </section>
  );
}

// ── Dashboard shell ──────────────────────────────────────────────────────────

function DashboardContent() {
  const { siteConfig } = useDocusaurusContext();
  const flags = siteConfig.customFields?.featureFlags as
    | { pro?: boolean; stripePayments?: boolean }
    | undefined;
  const stripePaymentsEnabled = Boolean(flags?.stripePayments);

  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      return (params.get("tab") as Tab) ?? "subscription";
    }
    return "subscription";
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!s) {
        window.location.href = "/sign-in";
        return;
      }
      setSession(s);
      setUser(s.user);
      setLoading(false);
    });

    const {
      data: { subscription: authSub },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (!s) window.location.href = "/sign-in";
    });

    return () => authSub.unsubscribe();
  }, []);

  const loadSubscription = useCallback(async () => {
    const { data } = await supabase.from("subscriptions").select("*").single();
    const latest = (data as Subscription | null) ?? null;
    if (latest) setSubscription(latest);
    return latest;
  }, []);

  useEffect(() => {
    if (!session) return;
    void loadSubscription();
  }, [session, loadSubscription]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  if (loading) {
    return (
      <div style={styles.centerContainer}>
        <div style={styles.spinner} />
        <p>Loading…</p>
      </div>
    );
  }

  if (!user) return null;

  const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture;
  const fullName =
    user.user_metadata?.full_name || user.user_metadata?.name || "User";
  return (
    <div className="dashboard-page" style={styles.container}>
      <div style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          {avatarUrl ? (
            <img src={avatarUrl} alt={fullName} style={styles.avatar} />
          ) : (
            <div style={styles.avatarPlaceholder}>{fullName[0]}</div>
          )}
          <div>
            <div style={styles.userName}>{fullName}</div>
            <div style={styles.userEmail}>{user.email}</div>
          </div>
        </div>

        <nav style={styles.nav}>
          <button
            onClick={() => setActiveTab("subscription")}
            style={{
              ...styles.navItem,
              ...(activeTab === "subscription" ? styles.navItemActive : {}),
            }}
          >
            Subscription
          </button>
          <button
            onClick={() => setActiveTab("integrations")}
            style={{
              ...styles.navItem,
              ...(activeTab === "integrations" ? styles.navItemActive : {}),
            }}
          >
            Integrations
          </button>
        </nav>

        <button onClick={handleSignOut} style={styles.signOutButton}>
          Sign Out
        </button>
      </div>

      <div style={styles.content}>
        {activeTab === "subscription" && (
          <SubscriptionTab
            subscription={subscription}
            reloadSubscription={loadSubscription}
            stripePaymentsEnabled={stripePaymentsEnabled}
          />
        )}

        {activeTab === "integrations" && <IntegrationsTab />}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  centerContainer: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    minHeight: "60vh",
  },
  spinner: {
    width: "32px",
    height: "32px",
    border: "3px solid var(--ifm-color-emphasis-200)",
    borderTopColor: "var(--ifm-color-primary)",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
    marginBottom: "1rem",
  },
  container: {
    display: "flex",
    width: "960px",
    margin: "0 auto",
    padding: "2rem 1rem",
    gap: "2rem",
    alignItems: "stretch",
    boxSizing: "border-box",
  },
  sidebar: {
    width: "240px",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
  },
  sidebarHeader: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    marginBottom: "1.5rem",
    paddingBottom: "1rem",
    borderBottom: "1px solid var(--ifm-color-emphasis-200)",
  },
  avatar: { width: "40px", height: "40px", borderRadius: "50%" },
  avatarPlaceholder: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    backgroundColor: "var(--ifm-color-primary)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 600,
    fontSize: "1.1rem",
  },
  userName: { fontWeight: 600, fontSize: "0.9rem" },
  userEmail: { fontSize: "0.75rem", color: "var(--ifm-color-emphasis-500)" },
  nav: { display: "flex", flexDirection: "column", gap: "0.25rem" },
  navItem: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "0.5rem 0.75rem",
    borderRadius: "6px",
    border: "none",
    backgroundColor: "transparent",
    color: "var(--ifm-font-color-base)",
    fontSize: "0.9rem",
    cursor: "pointer",
    transition: "all 0.15s",
  },
  navItemActive: {
    backgroundColor: "var(--ifm-color-emphasis-100)",
    fontWeight: 600,
  },
  signOutButton: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "0.5rem 0.75rem",
    borderRadius: "6px",
    border: "none",
    backgroundColor: "transparent",
    color: "#ef4444",
    fontSize: "0.9rem",
    cursor: "pointer",
    marginTop: "auto",
  },
  content: { flex: 1, minWidth: 0 },
  sectionTitle: { fontSize: "1.25rem", fontWeight: 700, marginBottom: "1rem" },
  card: {
    padding: "1.5rem",
    borderRadius: "10px",
    border: "1px solid var(--ifm-color-emphasis-200)",
    backgroundColor: "var(--ifm-background-color)",
  },
  field: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0.75rem 0",
    borderBottom: "1px solid var(--ifm-color-emphasis-100)",
  },
  fieldLabel: {
    fontSize: "0.85rem",
    color: "var(--ifm-color-emphasis-600)",
    fontWeight: 500,
  },
  fieldValue: { fontSize: "0.9rem", fontWeight: 500 },
  proBadge: {
    padding: "0.2rem 0.6rem",
    borderRadius: "12px",
    backgroundColor: "rgba(16,185,129,0.1)",
    color: "#10b981",
    fontSize: "0.8rem",
    fontWeight: 600,
  },
  freeBadge: {
    padding: "0.2rem 0.6rem",
    borderRadius: "12px",
    backgroundColor: "var(--ifm-color-emphasis-100)",
    color: "var(--ifm-color-emphasis-600)",
    fontSize: "0.8rem",
    fontWeight: 600,
  },
  primaryButton: {
    display: "inline-block",
    padding: "0.6rem 1.5rem",
    borderRadius: "8px",
    border: "none",
    background:
      "linear-gradient(135deg, var(--ifm-color-primary) 0%, var(--ifm-color-primary-dark) 100%)",
    color: "#fff",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s",
    textDecoration: "none",
  },
  primaryButtonDisabled: {
    opacity: 0.45,
    cursor: "not-allowed",
  },
  secondaryButton: {
    display: "inline-block",
    padding: "0.6rem 1.25rem",
    borderRadius: "8px",
    border: "1px solid var(--ifm-color-emphasis-300)",
    backgroundColor: "transparent",
    color: "var(--ifm-font-color-base)",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  billingActions: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.75rem",
    flexWrap: "wrap",
    marginTop: "1.5rem",
  },
  billingNote: {
    margin: "0.75rem 0 0",
    fontSize: "0.85rem",
    color: "var(--ifm-color-emphasis-700)",
  },
  notice: {
    marginBottom: "0.75rem",
    padding: "0.6rem 0.75rem",
    borderRadius: "6px",
    backgroundColor: "rgba(16,185,129,0.1)",
    color: "#059669",
    fontSize: "0.85rem",
  },
  errorText: { color: "#ef4444", fontSize: "0.85rem", marginTop: "0.75rem" },
  comingSoonSubtext: {
    marginTop: "0.5rem",
    fontSize: "0.8rem",
    color: "var(--ifm-color-emphasis-500)",
  },
  // Integrations tab
  integrationHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
  },
  integrationInfo: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.75rem",
    flex: 1,
    minWidth: 0,
  },
  integrationActions: { flexShrink: 0 },
  integrationIcon: {
    width: "36px",
    height: "36px",
    borderRadius: "8px",
    backgroundColor: "var(--ifm-color-emphasis-100)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  integrationName: { fontWeight: 600, fontSize: "0.9rem", marginBottom: "0.15rem" },
  integrationDesc: { fontSize: "0.8rem", color: "var(--ifm-color-emphasis-500)" },
  integrationFeatureList: {
    margin: "0.4rem 0 0",
    paddingLeft: "1.1rem",
    fontSize: "0.8rem",
    color: "var(--ifm-color-emphasis-600)",
    lineHeight: 1.55,
  },
  featureProBadge: {
    display: "inline-block",
    marginLeft: "0.25rem",
    padding: "0.05rem 0.35rem",
    borderRadius: "4px",
    backgroundColor: "rgba(16,185,129,0.12)",
    color: "#10b981",
    fontSize: "0.65rem",
    fontWeight: 700,
    letterSpacing: "0.04em",
    verticalAlign: "middle",
  },
  connectedBadge: {
    padding: "0.2rem 0.6rem",
    borderRadius: "12px",
    backgroundColor: "rgba(16,185,129,0.1)",
    color: "#10b981",
    fontSize: "0.8rem",
    fontWeight: 600,
  },
  repoSection: { marginTop: "1.25rem" },
  repoSectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "0.75rem",
  },
  repoSectionTitle: { fontSize: "0.85rem", fontWeight: 600 },
  manageLink: {
    fontSize: "0.8rem",
    color: "var(--ifm-color-primary)",
    textDecoration: "none",
  },
  loadingText: {
    fontSize: "0.85rem",
    color: "var(--ifm-color-emphasis-500)",
    padding: "0.5rem 0",
  },
  // Repo config panel
  repoCard: {
    border: "1px solid var(--ifm-color-emphasis-200)",
    borderRadius: "8px",
    marginBottom: "0.5rem",
    overflow: "hidden",
  },
  repoHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0.75rem 1rem",
    cursor: "pointer",
    userSelect: "none",
  },
  repoMeta: { display: "flex", alignItems: "center", gap: "0.5rem" },
  repoName: { fontSize: "0.875rem", fontWeight: 600, fontFamily: "monospace" },
  privateBadge: {
    fontSize: "0.7rem",
    padding: "0.1rem 0.4rem",
    borderRadius: "4px",
    backgroundColor: "var(--ifm-color-emphasis-100)",
    color: "var(--ifm-color-emphasis-600)",
  },
  repoStats: { display: "flex", alignItems: "center", gap: "0.5rem" },
  statBadge: {
    fontSize: "0.75rem",
    padding: "0.15rem 0.5rem",
    borderRadius: "10px",
    background: "rgba(16,185,129,0.1)",
    color: "#10b981",
    fontWeight: 500,
  },
  chevron: { fontSize: "0.7rem", color: "var(--ifm-color-emphasis-400)" },
  configBody: {
    borderTop: "1px solid var(--ifm-color-emphasis-100)",
    padding: "1rem",
    backgroundColor: "var(--ifm-background-surface-color)",
  },
  configSection: { marginBottom: "1rem" },
  configRow: { marginBottom: "0.75rem" },
  configRowInline: {
    display: "flex",
    gap: "1.5rem",
    marginBottom: "0.75rem",
    flexWrap: "wrap",
  },
  configLabel: {
    display: "block",
    fontSize: "0.78rem",
    fontWeight: 600,
    color: "var(--ifm-color-emphasis-600)",
    marginBottom: "0.3rem",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },
  input: {
    width: "100%",
    padding: "0.4rem 0.6rem",
    borderRadius: "6px",
    border: "1px solid var(--ifm-color-emphasis-200)",
    backgroundColor: "var(--ifm-background-color)",
    color: "var(--ifm-font-color-base)",
    fontSize: "0.85rem",
    outline: "none",
  },
  select: {
    width: "100%",
    padding: "0.4rem 0.6rem",
    borderRadius: "6px",
    border: "1px solid var(--ifm-color-emphasis-200)",
    backgroundColor: "var(--ifm-background-color)",
    color: "var(--ifm-font-color-base)",
    fontSize: "0.85rem",
    outline: "none",
  },
  inputHint: {
    fontSize: "0.73rem",
    color: "var(--ifm-color-emphasis-400)",
    marginTop: "0.2rem",
  },
  checkboxLabel: {
    display: "flex",
    alignItems: "center",
    fontSize: "0.85rem",
    cursor: "pointer",
  },
  queueStatusRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.4rem 0",
    fontSize: "0.82rem",
  },
  branchPill: {
    fontFamily: "monospace",
    fontSize: "0.8rem",
    padding: "0.1rem 0.4rem",
    borderRadius: "4px",
    backgroundColor: "var(--ifm-color-emphasis-100)",
  },
  queueStatusText: { color: "var(--ifm-color-emphasis-600)" },
  configActions: { display: "flex", justifyContent: "flex-end" },
  saveButton: {
    padding: "0.45rem 1.2rem",
    borderRadius: "6px",
    border: "none",
    background:
      "linear-gradient(135deg, var(--ifm-color-primary) 0%, var(--ifm-color-primary-dark) 100%)",
    color: "#fff",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
  },
};

export default function DashboardPage(): React.ReactNode {
  const { siteConfig } = useDocusaurusContext();
  const flags = siteConfig.customFields?.featureFlags as
    | { pro?: boolean; stripePayments?: boolean }
    | undefined;

  if (!flags?.pro) {
    return (
      <BrowserOnly>
        {() => {
          window.location.href = "/";
          return null;
        }}
      </BrowserOnly>
    );
  }

  return (
    <Layout title="Dashboard" description="Manage your Treq account">
      <Head>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <BrowserOnly>{() => <DashboardContent />}</BrowserOnly>
    </Layout>
  );
}
