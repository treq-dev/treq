---
sidebar_position: 8
---

# Trello and Jira Integrations

_How Treq lists Trello cards and Jira issues and opens a workspace for each one._

Treq reads cards from Trello and issues from Jira Cloud and shows them in a panel next to your workspaces. From any card or issue, **Kick off** opens the agent prompt with the item attached. When you start the session, Treq opens the item's workspace or creates it.

:::note[Work in progress]

Both integrations are feature previews. Turn on **Trello integration** or **Jira integration** in Settings under **Preview**. Jira support covers Jira Cloud only.

:::

## Connecting a Tracker

Credentials are stored per repository in Treq's local database on your machine. Requests go straight from the app to Trello or Atlassian. They do not pass through Treq's servers. Add them in Settings under **Integrations**.

| Tracker | Setting | Purpose |
|---|---|---|
| Trello | **API key** | Key from your Trello Power-Up admin page |
| Trello | **Token** | User token that you authorized for that API key |
| Jira | **Site URL** | Your site, for example `acme.atlassian.net` or just `acme` |
| Jira | **Email** | The Atlassian account that owns the API token |
| Jira | **API token** | A token from id.atlassian.com |
| Jira | **Issue query (JQL)** | Optional. Selects which issues the panel lists |
| Both | **Auto-kickoff label** | Optional. See [Auto-Kickoff with Labels](#auto-kickoff-with-labels) |

Without a JQL query, the Jira panel lists open issues that are assigned to you or that you reported.

## Browsing Cards and Issues

Open **Trello** or **Jira** in the workspace sidebar. The panel groups items by status: the list name for a Trello card, the workflow status for a Jira issue.

| Control | Trello | Jira |
|---|---|---|
| Selector | One board at a time. The first board opens by default. | **All projects** or one project |
| **All** | Every open card on the board | Every issue your query returns |
| **Active** | Cards not in a done-style list (for example `Done` or `Shipped`) | Issues outside the Done status category |
| **Mine** | Cards where you are a member | Issues assigned to you |

## Kicking Off a Workspace

**Kick off** opens **Start a new agent session** with the card or issue attached as a chip. The dialog does not show the workspace picker, because the item always runs in its own workspace. Your prompt gets a line that links the item. If you leave the prompt empty, Treq asks the agent to address the item.

When you start the session, Treq looks for a workspace on the item's branch and creates one if none exists. The new workspace targets the repository's default branch and takes its title and description from the item.

| Tracker | Branch name |
|---|---|
| Trello | `trello-<short link>-<title slug>`, for example `trello-AbC123xy-add-login` |
| Jira | `<issue key>-<title slug>`, for example `ENG-42-add-login` |

The Jira branch starts with the issue key, so Jira's development panel can link the branch to the issue. For a Jira issue with subtasks, **Kick off** also opens a workspace for each subtask. The workspace header shows a badge with the card or issue key. Click the badge to open the item in your browser.

## Auto-Kickoff with Labels

Set **Auto-kickoff label** to have Treq create workspaces without a click. Every 60 seconds, Treq checks open items that carry the label and creates a workspace for each new one. For Trello, it checks up to 25 open boards. For Jira, it runs its own query for the label and ignores your JQL setting.

Treq records each item it kicked off, so an item gets one workspace. If creation fails, Treq tries again on the next two checks and then stops. Remove the label and add it again to reset an item.

Auto-kickoff creates the workspace only. It does not start an agent session.
