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

Google Workspace needs a Pro plan. On other plans, Settings and the panel show an upgrade prompt instead.

Connect in Settings under **Integrations** with **Connect with Google**, which uses Treq's OAuth app. Settings shows the connection once you finish signing in. While it waits, **Cancel** stops waiting. If nothing arrives within about two minutes, Treq says it didn't hear back from Google sign-in; click **Connect with Google** to try again. If Treq cannot read the connection status, the **Status** row shows the error with **Retry**. When Google is not connected, the panel offers **Connect Google Workspace**, which opens those settings.

Your Google grant lives on Treq's servers. The app sends requests through the `google-proxy` function, which adds your token. The function only serves users with a Pro plan that is active, trialing or past due, or canceled but still inside its paid period, and only forwards the exact Tasks and Drive calls the app makes. It refuses anything else, such as deleting or sharing Drive files.

**Disconnect** in the **Status** row revokes the grant with Google and deletes it from Treq's servers, after you confirm. **Remove Google from your treq account** does the same when Google is not connected in this app, for example after a Pro plan lapses.

Treq asks for the `tasks` and `drive` scopes. Full Drive access is needed so the review can export any Doc you pick and post comments on it.

## Tasks

Each task list is a column, in the same order as Google Tasks. Treq loads at most four columns at a time, so an account with many lists does not send a burst of requests; **Refresh** follows the same limit. In a column you can:

- Add a task with **Add a task**.
- Complete or reopen a task with its circle. Completed tasks collapse under **Completed (n)**.
- Drag a card to another column to move it to that list, or onto another card to place it after that card. Dropping a card on empty space in its own column leaves it where it is. If some of a moved task's subtasks cannot follow it, Treq says how many and refreshes both columns.
- From the card's menu: **Kick off agent** opens the agent prompt with the task attached, like Linear, Trello and Jira kickoffs. The prompt holds the task's title, notes and the open subtasks shown on the card; long notes are cut at 4,000 characters and steps at 50. Starting it opens the workspace linked to the task, or creates one and links it. **Edit** changes the title and notes, **Add subtask** creates a subtask, and you can set or clear a due date, open the task in Google Tasks, or delete it. A due date saves when you press Enter or leave the field with a full date; Escape cancels. Delete asks first, and says when the task's subtasks will be deleted too. A task already deleted elsewhere counts as deleted.
- Link a task to an existing workspace with **Link to workspace…** in the card's menu, and pick one of the repository's workspaces. A linked card shows its workspace's name; **Unlink workspace** removes the link.
- Create a new list from the last column.

A workspace linked to a task shows a Google Task badge in its header that opens the task. When the workspace's pull request merges, Treq marks the task complete in Google Tasks, shows a toast saying so, and the badge shows the task as completed.

Cards are one level deep, like Google Tasks: a subtask of a subtask shows under its top-level task. An open subtask whose parent is completed shows as its own card, so it stays visible.

If a list fails to load, the error shows with **Retry**. When Google's grant has expired, **Reconnect in Settings** opens the Integrations settings.

With the [Linear integration](./linear-integration.md) on, a card's menu also has **Create Linear issue**. Pick a team; Treq creates the issue from the task's title and notes, then adds the issue link to the task's current notes, re-read from Google just before the write so edits made meanwhile are kept.

## Reviewing Docs and Drive Files

**Review** exports the file into `~/Documents/treq/exports/<repo key>/<file id>/`, where the repo key is a short hash of the repository path so each repository keeps its own export, and starts a review agent session at the repository root. The session does not auto-accept edits or commands: the document may have been written by anyone it is shared with, so the prompt marks it as untrusted and every action the agent tries needs your approval. Exports never go inside the repository, so jj cannot snapshot document contents into a change. Set `TREQ_EXPORTS_DIR` to use another folder. Google Docs export as Markdown, Sheets as CSV and Slides as plain text. Text files are downloaded as they are. Other files cannot be reviewed.

The agent records each finding with `treq agent-review add --target-type google_doc`, anchored to lines of the exported copy. The repository's **review agent** setting picks the agent. **Document review instructions** in the Google settings add to the prompt for that repository.

Click a file's findings count, or **Open review**, to open the document review viewer. It works like the code review viewer: the exported text with line numbers, and each finding shown after the last line it covers, with any suggested rewrite as a diff against those lines. **Resolve** marks a finding handled and **Delete** drops it; either way it is not posted. Treq loads the findings for all files in one request. If the file has no export yet, the viewer says so; run **Review** to create one.

Running **Review** or **Re-review** again replaces the export and its unposted findings, so treq asks first, and asks again if the number of findings changes in the meantime. The old findings are cleared only after the new review session has started; if it fails to start, they stay. While a review is being prepared, posting is disabled. **Open in Drive** opens the file.

**Post N comments to Drive** in the viewer's header sends each remaining finding to the file as a Drive comment. The comment quotes the exported lines it refers to and includes any suggested rewrite. Posted findings are marked resolved, so posting again does not duplicate them. A finding that fails to post stays listed for the next try. Drive shows these comments in the file's comment list; Google's API cannot anchor them to a text range in the Docs editor.
