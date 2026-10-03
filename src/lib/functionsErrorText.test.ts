import { describe, expect, it } from "vitest";
import { functionsErrorText } from "./functionsErrorText";

describe("functionsErrorText", () => {
  it("reads the function's error text from the response body", async () => {
    const error = Object.assign(new Error("non-2xx"), {
      context: new Response(JSON.stringify({ error: "Pro plan required" }), {
        status: 403,
      }),
    });
    expect(await functionsErrorText(error)).toBe("Pro plan required");
  });

  it("falls back to the error message", async () => {
    const error = Object.assign(new Error("Failed to fetch"), {
      context: new Response("oops", { status: 500 }),
    });
    expect(await functionsErrorText(error)).toBe("Failed to fetch");
    expect(await functionsErrorText("plain")).toBe("plain");
  });
});
