import React from "react";
import { OAuthCallback } from "../../../components/OAuthCallback";

const describeAccount = (data: Record<string, unknown> | null) =>
  String(data?.email ?? "your Google account");

export default function GoogleCallbackPage(): React.ReactNode {
  return (
    <OAuthCallback
      provider="Google Workspace"
      completeFunction="complete-google-oauth"
      describeAccount={describeAccount}
      title="Google Workspace Integration"
      description="Connecting your Google account"
    />
  );
}
