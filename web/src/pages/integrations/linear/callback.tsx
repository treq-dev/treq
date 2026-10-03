import React from "react";
import { OAuthCallback } from "../../../components/OAuthCallback";

const describeAccount = (data: Record<string, unknown> | null) =>
  `workspace ${String(data?.workspace_name ?? "Linear")}`;

export default function LinearCallbackPage(): React.ReactNode {
  return (
    <OAuthCallback
      provider="Linear"
      completeFunction="complete-linear-oauth"
      describeAccount={describeAccount}
      title="Linear Integration"
      description="Connecting your Linear workspace"
    />
  );
}
