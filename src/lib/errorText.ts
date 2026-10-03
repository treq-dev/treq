/** Message for a caught value: Tauri commands reject with a string, JS with an Error. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
