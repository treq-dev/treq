import { describe, expect, it } from "vitest";
import {
  RemoteFunctionError,
  remoteFunctionError,
} from "./remote-control-plane";

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

    const error = await remoteFunctionError({
      message: "Edge Function returned a non-2xx status code",
      context,
    });
    expect(error).toBeInstanceOf(RemoteFunctionError);
    expect(error).toMatchObject({
      message:
        "[invalid_request] sprite name must start with 'dev-'\nHTTP 400 · Correlation ID: corr-123",
      status: 400,
      code: "invalid_request",
    });
  });
});
