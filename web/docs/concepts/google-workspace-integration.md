---
sidebar_position: 9
---

# Google Workspace Integration

_How Treq shows Google Tasks as a Kanban board and runs the review agent on Google Docs and Drive files._

The **Google** panel has two tabs. **Tasks** shows your Google Tasks lists as Kanban columns. **Docs & Drive** lists your Drive files and runs the review agent on them.

:::note[Work in progress]

This integration is a feature preview and is off by default in every build. Turn on **Google Workspace integration** in Settings under **Preview**. Google Keep is not supported yet: its API is only open to Google Workspace domains through admin-approved service accounts.

:::

## Connecting Google

Connect in Settings under **Integrations**. There are two ways.

| Plan | How | Where tokens live |
|---|---|---|
| Free | Your own Desktop OAuth client from Google Cloud, with the Google Tasks API and Google Drive API enabled. Paste its client ID and secret, then click **Connect**. Treq opens Google sign-in and listens on a local port for the redirect. | Treq's local database on your machine. Requests go straight to Google. |
| Pro | **Connect with Google** uses Treq's OAuth app. | Treq's servers. The app sends requests through the `google-proxy` function, which adds your token. |

When both are set up, the local client wins.

The `google-proxy` function only serves users with an active Pro plan, and only forwards the exact Tasks and Drive calls the app makes. It refuses anything else, such as deleting or sharing Drive files. **Disconnect** next to **Connect with Google** revokes the grant with Google and deletes it from Treq's servers; it works even after a Pro plan lapses.

Treq asks for the `tasks` and `drive` scopes. Full Drive access is needed so the review can export any Doc you pick and post comments on it.

## Tasks

Each task list is a column, in the same order as Google Tasks. In a column you can:

- Add a task with **Add a task**.
- Complete or reopen a task with its circle. Completed tasks collapse under **Completed (n)**.
- Drag a card to another column to move it to that list, or onto another card to place it after that card.
- Set a due date, open the task in Google Tasks, or delete it from the card's menu.
- Create a new list from the last column.

With the [Linear integration](./linear-integration.md) on, a card's menu also has **Create Linear issue**. Pick a team; Treq creates the issue from the task's title and notes, then adds the issue link to the task's notes.

## Reviewing Docs and Drive Files

**Review** exports the file into `~/Documents/treq/exports/<file id>/` and starts a review agent session at the repository root. Exports never go inside the repository, so jj cannot snapshot document contents into a change. Set `TREQ_EXPORTS_DIR` to use another folder. Google Docs export as Markdown, Sheets as CSV and Slides as plain text. Text files are downloaded as they are. Other files cannot be reviewed.

The agent records each finding with `treq agent-review add --target-type google_doc`, anchored to lines of the exported copy. The repository's **review agent** setting picks the agent. **Document review instructions** in the Google settings add to the prompt for that repository.

**Post comments** sends each open finding to the file as a Drive comment. The comment quotes the exported lines it refers to and includes any suggested rewrite. Posted findings are marked resolved, so posting again does not duplicate them. Drive shows these comments in the file's comment list; Google's API cannot anchor them to a text range in the Docs editor.
