import { waitFor } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CiStatusIndicator } from "./CiStatusIndicator";
import * as api from "../lib/api";
import type { PrCiStatus } from "../lib/api-types";
import { render, screen } from "../../test/test-utils";

afterEach(() => {
	vi.restoreAllMocks();
});

const baseStatus: PrCiStatus = {
	state: "success",
	total: 2,
	passed: 2,
	failed: 0,
	pending: 0,
	checks: [
		{ name: "build", bucket: "pass", link: "https://x/1" },
		{ name: "lint", bucket: "pass", link: "https://x/2" },
	],
};

describe("CiStatusIndicator", () => {
	it("renders nothing while there is no CI status", async () => {
		const spy = vi.spyOn(api, "getCachedPrCiStatus").mockResolvedValue(null);
		vi.spyOn(api, "startPrStatusPolling").mockResolvedValue(undefined);

		render(<CiStatusIndicator repoPath="/repo" branchName="feat" />);
		await waitFor(() => expect(spy).toHaveBeenCalled());
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});

	it("shows the passed/total ratio when CI succeeded", async () => {
		vi.spyOn(api, "getCachedPrCiStatus").mockResolvedValue(baseStatus);
		vi.spyOn(api, "startPrStatusPolling").mockResolvedValue(undefined);

		render(<CiStatusIndicator repoPath="/repo" branchName="feat" />);

		expect(await screen.findByText("2/2")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /CI passed: 2\/2/ }),
		).toBeInTheDocument();
	});

	it("shows failing check names when CI failed", async () => {
		vi.spyOn(api, "getCachedPrCiStatus").mockResolvedValue({
			...baseStatus,
			state: "failure",
			passed: 1,
			failed: 1,
			checks: [
				{ name: "build", bucket: "pass", link: "https://x/1" },
				{ name: "test", bucket: "fail", link: "https://x/2" },
			],
		});
		vi.spyOn(api, "startPrStatusPolling").mockResolvedValue(undefined);

		render(<CiStatusIndicator repoPath="/repo" branchName="feat" />);

		expect(
			await screen.findByRole("button", { name: /CI failed: 1\/2/ }),
		).toBeInTheDocument();
	});

	it("lists failed checks first and opens the selected check URL", async () => {
		const user = userEvent.setup();
		vi.spyOn(api, "getCachedPrCiStatus").mockResolvedValue({
			...baseStatus,
			state: "failure",
			passed: 1,
			failed: 1,
			checks: [
				{ name: "build", bucket: "pass", link: "https://x/build" },
				{ name: "test", bucket: "fail", link: "https://x/test" },
			],
		});
		vi.spyOn(api, "startPrStatusPolling").mockResolvedValue(undefined);

		render(<CiStatusIndicator repoPath="/repo" branchName="feat" />);
		await user.click(
			await screen.findByRole("button", { name: /CI failed: 1\/2/ }),
		);

		const checkButtons = screen.getAllByRole("button", {
			name: /^(test|build)/i,
		});
		expect(checkButtons.map((button) => button.textContent)).toEqual([
			"testFailed",
			"buildSuccess",
		]);

		await user.click(screen.getByRole("button", { name: /^test/i }));
		expect(openUrl).toHaveBeenCalledWith("https://x/test");
	});
});
