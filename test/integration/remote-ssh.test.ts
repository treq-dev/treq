import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { Dashboard } from "../../src/components/Dashboard";
import {
  buildExplicitAliasSshEndpoint,
  listSshHosts,
  setSetting,
} from "../../src/lib/api";
import type {
  RemoteRepoProbe,
  RepositoryInspection,
} from "../../src/lib/api-types-remote";
import { dispatchLocal } from "../../src/lib/remote-dispatch";
import {
  listSavedRepositoriesForEndpoint,
  upsertSavedRemoteRepository,
} from "../../src/lib/remote-repository";
import { render, screen } from "../test-utils";

describe("remote SSH integration", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
    window.history.replaceState({}, "", "/");
  });

  it("opens the remote setup dialog from onboarding", async () => {
    render(React.createElement(Dashboard));
    await user.click(
      await screen.findByRole("button", { name: "Open via SSH" }),
    );

    expect(
      await screen.findByRole("dialog", {
        name: "Connect a remote repository",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Treq-managed VM/ }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Your own VM/ })).toBeTruthy();
  });

  it("keeps a saved remote repository closed until reconnect and trust validation succeed", async () => {
    const remoteRepository = {
      host: "devbox",
      path: "/srv/project",
      display_name: "devbox:project",
      repo_uri: "ssh://devbox/srv/project",
      inspection: {
        root: "/srv/project",
        repository_type: "jj_colocated",
        current_branch: "main",
        default_branch: "main",
        current_change_id: "change-id",
        current_commit_id: "commit-id",
        descriptor: {
          id: "ssh:devbox:/srv/project",
          location: { type: "ssh", host: "devbox", path: "/srv/project" },
          display_name: "devbox:project",
        },
      },
    };
    await setSetting(
      "last_opened_remote_repo",
      JSON.stringify(remoteRepository),
    );
    await setSetting("last_opened_remote_repo_id", "missing-descriptor");

    render(React.createElement(Dashboard));

    expect(
      await screen.findByRole("button", { name: "Open via SSH" }),
    ).toBeTruthy();
    expect(screen.queryByText("Remote repository connected")).toBeNull();
    await setSetting("last_opened_remote_repo", "");
    await setSetting("last_opened_remote_repo_id", "");
  });

  it("rejects an alias that resolves to no ~/.ssh/config Host block before any connection is made", async () => {
    await expect(
      buildExplicitAliasSshEndpoint({
        endpointId: "endpoint-test",
        alias: "devbox; rm -rf /",
        expectedFingerprint: "SHA256:abc",
        hostKeyAlgorithm: "ssh-ed25519",
        keyReference: "id_ed25519",
      }),
    ).rejects.toThrow("alias_not_found");
  });

  it("lists SSH hosts as an array even when no user config is present", async () => {
    await expect(listSshHosts()).resolves.toEqual(expect.any(Array));
  });

  it("persists two endpoint-generation-scoped repositories without secrets", async () => {
    await upsertSavedRemoteRepository({
      endpoint_id: "it-ep-1",
      endpoint_generation: 7,
      remote_path: "/srv/alpha",
    });
    await upsertSavedRemoteRepository({
      endpoint_id: "it-ep-1",
      endpoint_generation: 7,
      remote_path: "/srv/beta",
    });
    await upsertSavedRemoteRepository({
      endpoint_id: "it-ep-1",
      endpoint_generation: 7,
      remote_path: "/srv/alpha/",
    });

    const listed = await listSavedRepositoriesForEndpoint("it-ep-1", 7);
    expect(listed.map((repo) => repo.canonical_remote_path).sort()).toEqual([
      "/srv/alpha",
      "/srv/beta",
    ]);
    expect(JSON.stringify(listed)).not.toMatch(
      /private_key|password|passphrase|BEGIN OPENSSH/i,
    );
  });

  it("probes, clones, inspects, and inits through typed commands", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "treq-remote-typed-"));
    const source = path.join(dir, "source");
    fs.mkdirSync(source);
    const empty = path.join(dir, "empty");
    fs.mkdirSync(empty);

    const missingProbe = await dispatchLocal<RemoteRepoProbe>({
      kind: "ProbeRepo",
      repo: empty,
    });
    expect(missingProbe.is_repo).toBe(false);
    expect(missingProbe.needs_clone).toBe(true);

    const initialized = await dispatchLocal<RepositoryInspection>({
      kind: "InitRepo",
      repo: source,
      idempotency_key: "test-init-1",
    });
    expect(initialized.repository_type).toBeTruthy();

    const inspected = await dispatchLocal<RepositoryInspection>({
      kind: "InspectRepository",
      repo: source,
    });
    expect(inspected.root).toContain("source");

    const cloneDest = path.join(dir, "clone");
    const cloned = await dispatchLocal<RepositoryInspection>({
      kind: "CloneRepo",
      repo_url: source,
      destination: cloneDest,
      idempotency_key: "test-clone-1",
    });
    expect(cloned.root).toContain("clone");

    const cloneProbe = await dispatchLocal<RemoteRepoProbe>({
      kind: "ProbeRepo",
      repo: cloneDest,
    });
    expect(cloneProbe.is_repo).toBe(true);
  });
});
