import { errorText } from "./errorText";

/**
 * Message for a failed `supabase.functions.invoke`. A non-2xx response comes
 * back as a `FunctionsHttpError` whose message is generic ("Edge Function
 * returned a non-2xx status code"); the function's own `{ error }` text is
 * in the response body, `error.context`.
 */
export async function functionsErrorText(error: unknown): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context;
  if (hasJson(context)) {
    try {
      const body = (await context.clone().json()) as {
        error?: unknown;
        message?: unknown;
      };
      const text = body?.error ?? body?.message;
      if (typeof text === "string" && text) return text;
    } catch {
      // Not JSON; fall back to the error's own message.
    }
  }
  return errorText(error);
}

function hasJson(
  value: unknown,
): value is { clone: () => { json: () => Promise<unknown> } } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { clone?: unknown }).clone === "function"
  );
}
