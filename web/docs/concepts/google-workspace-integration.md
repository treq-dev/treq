---
sidebar_position: 9
---

# Google Workspace Integration

_How Treq shows Google Tasks as a Kanban board and runs the review agent on Google Docs and Drive files._

The **Google Workspace** panel has two tabs. **Tasks** shows your Google Tasks lists as Kanban columns. **Docs & Drive** lists your Drive files and runs the review agent on them.

:::note[Work in progress]

This integration is a feature preview and is off by default in every build. Turn on **Google Workspace integration** in Settings under **Preview**. Google Keep is not supported yet: its API is only open to Google Workspace domains through admin-approved service accounts.

:::

## Connecting Google

Connect in Settings under **Integrations**. There are two ways.

| Plan | How | Where tokens live |
|---|---|---|
| Free | Your own Desktop OAuth client from Google Cloud, with the Google Tasks API and Google Drive API enabled. Paste its client ID and secret, then click **Connect**. Treq opens Google sign-in and listens on a local port for the redirect. While it waits, **Reopen sign-in page** opens the page again and **Cancel** stops waiting. | Treq's local database on your machine. Requests go straight to Google. |
| Pro | **Connect with Google** uses Treq's OAuth app. Settings shows the connection once you finish signing in. While it waits, **Cancel** stops waiting. If nothing arrives within about two minutes, Treq says it didn't hear back from Google sign-in; click **Connect with Google** to try again. | Treq's servers. The app sends requests through the `google-proxy` function, which adds your token. |

When both are set up, the local client wins, so **Connect with Google** is disabled while your own client is connected; disconnect it first. If Treq cannot read the connection status, the **Status** row shows the error with **Retry**.

The `google-proxy` function only serves users with a Pro plan that is active, trialing or past due, or canceled but still inside its paid period, and only forwards the exact Tasks and Drive calls the app makes. It refuses anything else, such as deleting or sharing Drive files. **Disconnect** in the **Status** row disconnects whichever connection is active, after you confirm. For a Pro connection it revokes the grant with Google and deletes it from Treq's servers. **Remove Google from your treq account** does the same when that connection is not the active one, for example after a Pro plan lapses.

Treq asks for the `tasks` and `drive` scopes. Full Drive access is needed so the review can export any Doc you pick and post comments on it.

## Tasks

Each task list is a column, in the same order as Google Tasks. Treq loads at most four columns at a time, so an account with many lists does not send a burst of requests; **Refresh** follows the same limit. In a column you can:

- Add a task with **Add a task**.
- Complete or reopen a task with its circle. Completed tasks collapse under **Completed (n)**.
- Drag a card to another column to move it to that list, or onto another card to place it after that card. Dropping a card on empty space in its own column leaves it where it is. If some of a moved task's subtasks cannot follow it, Treq says how many and refreshes both columns.
- From the card's menu: **Kick off agent** opens the agent prompt with the task's title, notes and the open subtasks shown on the card as a plain prompt. Unlike Linear, Trello and Jira kickoffs, it does not attach an issue or link the task to the workspace. Long notes are cut at 4,000 characters and steps at 50. **Edit** changes the title and notes, **Add subtask** creates a subtask, and you can set or clear a due date, open the task in Google Tasks, or delete it. A due date saves when you press Enter or leave the field with a full date; Escape cancels. Delete asks first, and says when the task's subtasks will be deleted too. A task already deleted elsewhere counts as deleted.
- Create a new list from the last column.

Cards are one level deep, like Google Tasks: a subtask of a subtask shows under its top-level task. An open subtask whose parent is completed shows as its own card, so it stays visible.

If a list fails to load, the error shows with **Retry**. When Google's grant has expired, **Reconnect in Settings** opens the Integrations settings.

With the [Linear integration](./linear-integration.md) on, a card's menu also has **Create Linear issue**. Pick a team; Treq creates the issue from the task's title and notes, then adds the issue link to the task's current notes, re-read from Google just before the write so edits made meanwhile are kept.

## Reviewing Docs and Drive Files

**Review** exports the file into `~/Documents/treq/exports/<repo key>/<file id>/`, where the repo key is a short hash of the repository path so each repository keeps its own export, and starts a review agent session at the repository root. The session does not auto-accept edits or commands: the document may have been written by anyone it is shared with, so the prompt marks it as untrusted and every action the agent tries needs your approval. Exports never go inside the repository, so jj cannot snapshot document contents into a change. Set `TREQ_EXPORTS_DIR` to use another folder. Google Docs export as Markdown, Sheets as CSV and Slides as plain text. Text files are downloaded as they are. Other files cannot be reviewed.

The agent records each finding with `treq agent-review add --target-type google_doc`, anchored to lines of the exported copy. The repository's **review agent** setting picks the agent. **Document review instructions** in the Google settings add to the prompt for that repository.

The file's row then shows its findings. Treq loads the findings for all files in one request. Expand them to read each one with its line range and any suggested rewrite, and drop the ones you do not want. Running **Review** again replaces the export and its unposted findings, so treq asks first, and asks again if the number of findings changes in the meantime. The old findings are cleared only after the new review session has started; if it fails to start, they stay. While a review is being prepared, posting and dropping findings are disabled. A finding that is already gone counts as dropped.

**Post comments to Drive** sends each remaining finding to the file as a Drive comment. The comment quotes the exported lines it refers to and includes any suggested rewrite. Posted findings are marked resolved, so posting again does not duplicate them. A finding that fails to post stays listed for the next try. Drive shows these comments in the file's comment list; Google's API cannot anchor them to a text range in the Docs editor.
