import React, { useEffect, useState } from "react";
import Layout from "@theme/Layout";
import BrowserOnly from "@docusaurus/BrowserOnly";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import { supabase } from "../lib/supabase";

type State = "loading" | "success" | "error" | "unauthenticated";

export interface OAuthCallbackProps {
  /** Shown to the user, e.g. "Linear". */
  provider: string;
  /** Edge Function that verifies the state and stores the grant. */
  completeFunction: string;
  /** What the account was connected as, from the function's response. */
  describeAccount: (data: Record<string, unknown> | null) => string;
  title: string;
  description: string;
}

function CallbackContent({
  provider,
  completeFunction,
  describeAccount,
}: Pick<
  OAuthCallbackProps,
  "provider" | "completeFunction" | "describeAccount"
>) {
  const [state, setState] = useState<State>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const callbackState = params.get("state");

      if (!code) {
        setState("error");
        setMessage("No authorization code in URL.");
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setState("unauthenticated");
        setMessage(
          `Please sign in, then restart the ${provider} connection from the dashboard.`,
        );
        return;
      }

      if (!callbackState) {
        setState("error");
        setMessage("No state parameter in URL.");
        return;
      }

      const { data, error } = await supabase.functions.invoke(
        completeFunction,
        {
          body: {
            code,
            state: callbackState,
          },
        },
      );

      if (error || data?.error) {
        setState("error");
        setMessage(data?.error ?? error?.message ?? "Unknown error");
        return;
      }

      setState("success");
      setMessage(describeAccount(data ?? null));

      setTimeout(() => {
        window.location.href = "/dashboard?tab=integrations";
      }, 2000);
    };

    run();
  }, [completeFunction, describeAccount, provider]);

  return (
    <div style={styles.container}>
      {state === "loading" && (
        <>
          <div style={styles.spinner} />
          <p style={styles.text}>Connecting {provider}…</p>
        </>
      )}

      {state === "success" && (
        <>
          <div style={styles.icon}>✓</div>
          <p style={styles.text}>
            Connected {provider}: {message}. Redirecting to your dashboard…
          </p>
        </>
      )}

      {state === "error" && (
        <>
          <div style={{ ...styles.icon, color: "#ef4444" }}>✕</div>
          <p style={{ ...styles.text, color: "#ef4444" }}>
            Connection failed: {message}
          </p>
          <a href="/dashboard?tab=integrations" style={styles.link}>
            Return to dashboard
          </a>
        </>
      )}

      {state === "unauthenticated" && (
        <>
          <p style={styles.text}>
            You need to be signed in to link {provider}.
          </p>
          <a
            href={`/sign-in?redirect=${encodeURIComponent(window.location.href)}`}
            style={styles.link}
          >
            Sign in
          </a>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "60vh",
    gap: "1rem",
  },
  spinner: {
    width: "32px",
    height: "32px",
    border: "3px solid var(--ifm-color-emphasis-200)",
    borderTopColor: "var(--ifm-color-primary)",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  icon: {
    fontSize: "3rem",
    color: "#10b981",
    fontWeight: 700,
  },
  text: {
    fontSize: "1rem",
    textAlign: "center",
    maxWidth: "480px",
  },
  link: {
    color: "var(--ifm-color-primary)",
    textDecoration: "underline",
    cursor: "pointer",
  },
};

/** Landing page for a Pro OAuth redirect: completes the grant server side. */
export function OAuthCallback({
  title,
  description,
  ...content
}: OAuthCallbackProps): React.ReactNode {
  const { siteConfig } = useDocusaurusContext();
  const flags = siteConfig.customFields?.featureFlags as
    | { pro?: boolean }
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
    <Layout title={title} description={description}>
      <BrowserOnly>{() => <CallbackContent {...content} />}</BrowserOnly>
    </Layout>
  );
}
