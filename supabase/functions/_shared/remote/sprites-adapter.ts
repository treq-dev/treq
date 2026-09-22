// Fly Sprites provider adapter for the control plane, mirroring
// `core::remote_provider_sprites::SpritesProvider` in src-tauri. This is the
// Deno-side equivalent used by Edge Functions: same vendor API shape, same
// state normalization, same idempotency-header convention. Vendor status
// strings and vendor SDK types must never leave this module.

import type { RegionCode, SizePreset } from "./catalog.ts";

export type ManagedInstanceState =
  | "unprovisioned"
  | "provisioning"
  | "bootstrapping"
  | "installing_access"
  | "verifying"
  | "ready"
  | "suspended"
  | "waking"
  | "reprovisioning"
  | "degraded"
  | "failed"
  | "deleting"
  | "deleted";

export interface ProviderInstance {
  providerResourceId: string;
  state: ManagedInstanceState;
  region: RegionCode;
  sizePreset: SizePreset;
  address: string | null;
}

export class ProviderError extends Error {
  constructor(
    public readonly kind:
      | "not_found"
      | "already_exists"
      | "quota_exceeded"
      | "invalid_request"
      | "unavailable"
      | "timeout"
      | "other",
    message: string,
  ) {
    super(message);
  }
}

export interface CreateInstanceParams {
  ownerUserId: string;
  region: RegionCode;
  sizePreset: SizePreset;
  manifestVersion: number;
  idempotencyKey: string;
}

export interface ReplaceInstanceParams {
  providerResourceId: string;
  region: RegionCode;
  sizePreset: SizePreset;
  manifestVersion: number;
  idempotencyKey: string;
}

export interface MachineExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ManagedComputeProvider {
  createInstance(params: CreateInstanceParams): Promise<ProviderInstance>;
  getInstance(providerId: string): Promise<ProviderInstance>;
  wakeInstance(providerId: string): Promise<void>;
  replaceInstance(params: ReplaceInstanceParams): Promise<ProviderInstance>;
  deleteInstance(providerId: string): Promise<void>;
  // Runs a command through the documented non-TTY HTTP exec endpoint. The
  // provider token remains server-side.
  execOnMachine(
    providerId: string,
    command: string[],
    timeoutSeconds?: number,
    environment?: Readonly<Record<string, string>>,
  ): Promise<MachineExecResult>;
}

function normalizeState(vendorState: string): ManagedInstanceState {
  switch (vendorState) {
    case "creating":
      return "provisioning";
    case "warm":
    case "running":
      return "ready";
    case "cold":
    case "paused":
      return "suspended";
    default:
      return "degraded";
  }
}

// deno-lint-ignore no-explicit-any
function normalizeInstance(sprite: any): ProviderInstance {
  return {
    // Sprite names, rather than opaque UUIDs, address every lifecycle and
    // exec endpoint in the public API.
    providerResourceId: sprite.name,
    state: normalizeState(sprite.status),
    // Retained only while the provider-neutral database fields are migrated
    // to optional capabilities. Sprites does not accept either setting.
    region: "us_east",
    sizePreset: "small",
    address: null,
  };
}

export interface SpritesConfig {
  baseUrl: string;
  apiToken: string;
}

/// Reads Fly Sprites configuration from Edge Function secrets. Never logged;
/// never returned to a client.
export function spritesConfigFromEnv(): SpritesConfig {
  const baseUrl =
    Deno.env.get("SPRITES_API_URL") ?? Deno.env.get("FLY_SPRITES_API_BASE_URL");
  const apiToken =
    Deno.env.get("SPRITES_API_TOKEN") ?? Deno.env.get("FLY_SPRITES_API_TOKEN");
  if (!baseUrl || !apiToken) {
    throw new ProviderError(
      "invalid_request",
      "SPRITES_API_URL and SPRITES_API_TOKEN must be set",
    );
  }
  return { baseUrl, apiToken };
}

export class SpritesProvider implements ManagedComputeProvider {
  constructor(private readonly config: SpritesConfig) {}

  private spritesUrl(): string {
    return `${this.config.baseUrl.replace(/\/+$/, "")}/v1/sprites`;
  }

  private spriteUrl(name: string): string {
    return `${this.spritesUrl()}/${encodeURIComponent(name)}`;
  }

  async execOnMachine(
    providerId: string,
    command: string[],
    timeoutSeconds = 20,
    environment: Readonly<Record<string, string>> = {},
  ): Promise<MachineExecResult> {
    if (command.length === 0) {
      throw new ProviderError("invalid_request", "command is required");
    }

    const url = new URL(`${this.spriteUrl(providerId)}/exec`);
    for (const arg of command) url.searchParams.append("cmd", arg);
    for (const [name, value] of Object.entries(environment)) {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
        throw new ProviderError("invalid_request", "invalid environment name");
      }
      url.searchParams.append("env", `${name}=${value}`);
    }
    url.searchParams.set("path", command[0]);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        signal: AbortSignal.timeout(timeoutSeconds * 1_000),
      });
      if (!response.ok) throw await this.mapErrorResponse(response);
      return { exitCode: 0, stdout: await response.text(), stderr: "" };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(
        err instanceof DOMException && err.name === "TimeoutError"
          ? "timeout"
          : "unavailable",
        `Sprite exec failed: ${(err as Error).message}`,
      );
    }
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.config.apiToken}`,
      "Content-Type": "application/json",
    };
  }

  private async mapErrorResponse(response: Response): Promise<ProviderError> {
    const text = await response.text().catch(() => "");
    const truncated = text.length > 500 ? `${text.slice(0, 500)}…` : text;
    switch (response.status) {
      case 404:
        return new ProviderError("not_found", "instance not found");
      case 409:
        return new ProviderError("already_exists", "instance already exists");
      case 429:
        return new ProviderError("quota_exceeded", "provider quota exceeded");
      case 400:
      case 422:
        return new ProviderError("invalid_request", truncated);
      default:
        if (response.status >= 500)
          return new ProviderError("unavailable", truncated);
        return new ProviderError("other", truncated);
    }
  }

  async createInstance(
    params: CreateInstanceParams,
  ): Promise<ProviderInstance> {
    const name = `dev-treq-${params.ownerUserId}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .slice(0, 63);
    const body = { name };

    let response: Response;
    try {
      response = await fetch(this.spritesUrl(), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ProviderError(
        "unavailable",
        `could not reach Sprites API: ${(err as Error).message}`,
      );
    }

    if (response.status === 409) {
      // A repeated create with the same idempotency key/machine name: treat
      // the vendor's existing-resource response as success rather than an
      // error, so create stays idempotent for the caller.
      return await this.getInstance(name);
    }
    if (!response.ok) throw await this.mapErrorResponse(response);
    return normalizeInstance(await response.json());
  }

  async getInstance(providerId: string): Promise<ProviderInstance> {
    let response: Response;
    try {
      response = await fetch(this.spriteUrl(providerId), {
        headers: this.headers(),
      });
    } catch (err) {
      throw new ProviderError(
        "unavailable",
        `could not reach Sprites API: ${(err as Error).message}`,
      );
    }
    if (!response.ok) throw await this.mapErrorResponse(response);
    return normalizeInstance(await response.json());
  }

  async wakeInstance(providerId: string): Promise<void> {
    // Sprites wake on the first API operation. A GET is the cheapest
    // idempotent operation and also proves the resource still exists.
    await this.getInstance(providerId);
  }

  async replaceInstance(
    params: ReplaceInstanceParams,
  ): Promise<ProviderInstance> {
    // Sprites are durable user environments. Repairing the Treq bootstrap
    // preserves the Sprite and its filesystem; deletion remains an explicit
    // user action handled by deleteInstance.
    return await this.getInstance(params.providerResourceId);
  }

  async deleteInstance(providerId: string): Promise<void> {
    let response: Response;
    try {
      response = await fetch(this.spriteUrl(providerId), {
        method: "DELETE",
        headers: this.headers(),
      });
    } catch (err) {
      throw new ProviderError(
        "unavailable",
        `could not reach Sprites API: ${(err as Error).message}`,
      );
    }
    if (response.ok || response.status === 404) return;
    throw await this.mapErrorResponse(response);
  }
}
