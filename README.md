<div align="center">

![treq](./assets/combined-horizontal.png)

</div>

# treq

Treq is the open-source Stacking Agent Development Environment (ADE) for parallel development, review, and delivery. It gives teams isolated workspaces, stacked branches, and AI-assisted workflows without giving up control of their code.

![Code Overview](./assets/screenshots/code.png)

## Getting Started

Download the latest release [here](https://github.com/Ziinc/treq/releases).

## Features

### Code Reviews

Inspect and iterate on each change for a human-in-the-loop agentic workflow.

![Code Review](./assets/screenshots/review.png)

- Review the code diffs just like a familiar Github PR, annotate and comment on code, and then send it to an agent for changes.
- Spotted an issue when browsing files? Send it to an agent for adjustments in the background.
- Got a specific commit that you want the agent to work on, review it and send your comments directly to the agent. Did I mention that we have commit management tooling as well?

![Commit History](./assets/screenshots/commits.png)

### Workspaces

Coding agents work in isolated copies of the codebase, ensuring changes are independent from each other while keeping your current repository clean for planning.

<!-- insert gif of worktree creation -->

- Workspaces are isolated but and **automatically rebased**, meaning code never goes stale.

- Got a code conflict? Agents can **automatically resolve your conflicts**.

- Stack workspaces and build features incrementally over smaller bite-sized branches. All stacked workspaces automatically rebases on top of each other, **even on top of your uncommitted changes**.

<!-- insert gif of stacking -->


## Developer

### Bumping the version

```bash
make bump           # prompts for the new version
make bump VERSION=0.1.3   # non-interactive
```

Updates `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock` in one step.

```bash
# to profile benchmark code
samply record cargo bench --bench sync_workspaces
```

## License

Licensed under the Apache License, Version 2.0
