import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "../../test-utils";
import userEvent from "@testing-library/user-event";
import { findReviewCopyButton, setupReviewMode } from "./comments-helpers";
import { runSerially } from "../../utils";

runSerially();

describe("Copy button in Finish Review popover", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
  });

  it("should NOT show copy button in header bar", async () => {
    await setupReviewMode(user, "feat/no-copy-header");

    await waitFor(() => {
      const discardButtons = screen.getAllByRole("button", {
        name: /discard/i,
      });
      const reviewDiscardButton = discardButtons.find(
        (btn) => btn.textContent === "Discard",
      );
      expect(reviewDiscardButton).toBeInTheDocument();
    });

    const copyButtons = screen.queryAllByRole("button", { name: /copy/i });
    const discardButtons = screen.getAllByRole("button", { name: /discard/i });
    const reviewDiscardButton = discardButtons.find(
      (btn) => btn.textContent === "Discard",
    )!;
    const headerContainer = reviewDiscardButton.parentElement;

    const copyButtonsInHeader = copyButtons.filter((btn) =>
      headerContainer?.contains(btn),
    );
    expect(copyButtonsInHeader.length).toBe(0);
  });

  it("copies the review from the Finish Review popover", async () => {
    const clipboardSpy = vi.spyOn(navigator.clipboard, "writeText");

    await setupReviewMode(user, "feat/copy-review-popover");

    const finishButton = await screen.findByRole("button", {
      name: /finish review/i,
    });
    await user.click(finishButton);

    await waitFor(() => {
      expect(findReviewCopyButton()).toBeInTheDocument();
    });

    const copyButton = findReviewCopyButton();
    const planButton = screen.getByRole("button", { name: /^plan$/i });
    const editButton = screen.getByRole("button", { name: /^edit$/i });
    const allButtons = screen.getAllByRole("button");
    expect(allButtons.indexOf(copyButton)).toBeLessThan(
      allButtons.indexOf(planButton),
    );
    expect(allButtons.indexOf(copyButton)).toBeLessThan(
      allButtons.indexOf(editButton),
    );
    await screen.findByRole("button", { name: /^close$/i });

    await user.click(copyButton);

    await waitFor(() => {
      expect(clipboardSpy).toHaveBeenCalledWith(
        expect.stringContaining("Test comment"),
      );
    });
    await screen.findByRole("button", { name: /^copied review$/i });
    expect(screen.queryByText("Copied to clipboard")).not.toBeInTheDocument();
  });
});
