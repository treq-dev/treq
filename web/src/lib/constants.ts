export const PAYMENT_LINK_URL =
  process.env.NODE_ENV === "production"
    ? "https://buy.stripe.com/your-prod-payment-link"
    : "https://buy.stripe.com/test_aFa4gzacLbZ40lHdPNbAs01";

export const APP_DEEP_LINK = "treq://";

// GitHub App — update with your actual App slug after creating it at
// https://github.com/settings/apps/new
export const GITHUB_APP_NAME =
  process.env.NODE_ENV === "production" ? "treq-merge-queue" : "treq-merge-queue-dev";

export const GITHUB_APP_INSTALL_URL = `https://github.com/apps/${GITHUB_APP_NAME}/installations/new`;
