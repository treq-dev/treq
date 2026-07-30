import { describe, expect, it } from "vitest";
import {
	listSshHosts,
	remoteOpenRepo,
	remoteProbeRepo,
} from "../../src/lib/api";

describe("remote SSH integration", () => {
	it("opens a remote repository identity through the NAPI dispatcher", async () => {
		const repo = await remoteOpenRepo("devbox", "/srv/project");

		expect(repo).toEqual({
			host: "devbox",
			path: "/srv/project",
			display_name: "devbox:project",
			repo_uri: "ssh://devbox/srv/project",
		});
	});

	it("rejects unsafe SSH host aliases before opening a connection", async () => {
		await expect(
			remoteProbeRepo("devbox; rm -rf /", "/srv/project"),
		).rejects.toThrow("SSH host must be a host alias from ssh config");
	});

	it("lists SSH hosts as an array even when no user config is present", async () => {
		await expect(listSshHosts()).resolves.toEqual(expect.any(Array));
	});
});
