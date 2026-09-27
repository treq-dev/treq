import {
  act,
  fireEvent,
  type RenderOptions,
  render,
  screen as rtlScreen,
} from "@testing-library/react";
import { type ReactNode, useMemo } from "react";
import { SWRConfig } from "swr";
import { Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { ToastProvider } from "../src/components/ui/toast";
import { createTestSWRConfig, SWRMutateScope } from "../src/lib/swr-cache";
import { AppStoreEffects } from "../src/stores/AppStoreEffects";

/**
 * Creates a wrapper with SWR, toast host, and Zustand store effects.
 */
const AllTheProviders = ({ children }: { children: ReactNode }) => {
  const swrConfig = useMemo(() => createTestSWRConfig(), []);
  return (
    <Router hook={useHashLocation}>
      <ToastProvider>
        <SWRConfig value={swrConfig}>
          {/* Inside SWRConfig so settings hydration uses this render's cache,
              not SWR's global cache shared by every test in the file. */}
          <AppStoreEffects />
          <SWRMutateScope>{children}</SWRMutateScope>
        </SWRConfig>
      </ToastProvider>
    </Router>
  );
};

const customRender = (ui: React.ReactElement, options?: RenderOptions) =>
  render(ui, { wrapper: AllTheProviders, ...options });

const settleReactUpdates = async () => {
  await act(async () => {
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
};

const screen = {
  ...rtlScreen,
  clickByText: async (text: string | RegExp) => {
    const el = await rtlScreen.findByText(text);
    fireEvent.click(el);
  },
  clickByRole: async (role: string, options?: Record<string, unknown>) => {
    const el = options
      ? await rtlScreen.findByRole(role, options)
      : await rtlScreen.findByRole(role);
    fireEvent.click(el);
  },
};

export * from "@testing-library/react";

export { customRender as render, screen, settleReactUpdates };
