import { describe, expect, it } from "vitest";
import { remoteFunctionError } from "./remote-control-plane";

describe("remoteFunctionError", () => {
  it("formats a copyable server error with code, status, and correlation id", async () => {
    const context = new Response(
      JSON.stringify({
        error: "sprite name must start with 'dev-'",
        code: "invalid_request",
        correlation_id: "corr-123",
      }),
      { status: 400 },
    );

    await expect(
      remoteFunctionError({
        message: "Edge Function returned a non-2xx status code",
        context,
      }),
    ).resolves.toEqual(
      new Error(
        "[invalid_request] sprite name must start with 'dev-'\nHTTP 400 · Correlation ID: corr-123",
      ),
    );
  });
});
