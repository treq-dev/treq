import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "../../test/test-utils";
import type { LogRecordView } from "../lib/api-types";
import { LogFeed } from "./LogFeed";

const records: LogRecordView[] = [
  {
    timestamp: "2026-01-01T12:00:00Z",
    severity_number: 9,
    severity_text: "INFO",
    body: "first searchable message",
    trace_id: "trace",
    span_id: "span",
    run_id: 1,
    job_id: "job",
    step_index: 0,
    step_name: "step",
    stream: "stdout",
  },
  {
    timestamp: "2026-01-01T12:00:01Z",
    severity_number: 9,
    severity_text: "INFO",
    body: "second message",
    trace_id: "trace",
    span_id: "span-2",
    run_id: 1,
    job_id: "job",
    step_index: 0,
    step_name: "step",
    stream: "stdout",
  },
];

function feed(onSendToAgent = vi.fn()) {
  render(
    <LogFeed
      records={records}
      testId="feed"
      lineTestId="line"
      emptyMessage="Empty"
      onSendToAgent={onSendToAgent}
    />,
  );
  return onSendToAgent;
}

describe("LogFeed", () => {
  it("shows inspection and send action only for one selected row", async () => {
    const user = userEvent.setup();
    const send = feed();
    expect(screen.queryByTestId("send-to-agent")).toBeNull();
    await user.click(screen.getAllByTestId("line")[0]);
    expect(screen.getByTestId("log-inspect-panel")).toHaveTextContent(
      "first searchable message",
    );
    await user.click(screen.getByTestId("send-to-agent"));
    expect(send).toHaveBeenCalledWith([records[0]]);
  });

  it("opens VSCode-style find with Ctrl+F and highlights matches", async () => {
    const user = userEvent.setup();
    feed();
    await user.keyboard("{Control>}f{/Control}");
    await user.type(screen.getByPlaceholderText("Find"), "searchable");
    expect(screen.getByText("searchable").tagName).toBe("MARK");
    expect(screen.getByText("1 of 1")).toBeTruthy();
  });
});
