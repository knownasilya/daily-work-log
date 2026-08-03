# Daily Work Log

A tiny desktop app for keeping a running log of what you work on each day — and turning it into a Slack-ready status update in one click.

Built with [Tauri](https://tauri.app), [SvelteKit](https://svelte.dev/docs/kit), and TypeScript. Your data lives in a local SQLite database on your machine; nothing is sent anywhere.

<p align="center">
  <img src="docs/screenshot.png" alt="Daily Work Log showing the Focus, Log, Upcoming, and Note sections for a day" width="340">
</p>

## What it does

Each day is organized into a few simple lists:

- **Focus** — what you intend to get done today. Check an item off and it drops into the Log as completed.
- **Log** — what you actually did, each line tagged with a Slack emoji.
- **Upcoming** — what's next; carries over to seed the following day.
- **Custom sections** — add your own lists (e.g. "Blockers", "Meetings").
- **Note** — a free-form scratch area for the day.

When you're ready to post, **Copy tasks** formats everything with the right `:emoji:` prefixes and copies it to your clipboard, ready to paste into Slack.

## Features

- **Emoji rules** — auto-assign a Slack emoji to an entry when its text matches a pattern (a plain substring or a `/regex/`). Reorder rules to set match priority, and pick defaults for upcoming and completed items.
- **Pinning** — pin recurring items so they carry forward to the next day.
- **Day carry-over** — unfinished focus and upcoming items seed the next day automatically (configurable).
- **@mentions** — autocomplete teammates and drop them into your update.
- **History & weekly view** — browse and search past days, and see a weekly breakdown by emoji.
- **Local & private** — everything is stored in a local SQLite database; no account, no sync, no network.
- **Lives in your tray** — closing the window keeps the app running in the menu bar / tray.

## Development

Requires [Node.js](https://nodejs.org) with [pnpm](https://pnpm.io), plus the [Rust toolchain](https://www.rust-lang.org/tools/install) for Tauri.

```bash
pnpm install
pnpm tauri dev      # build and run the desktop app
```

Other useful scripts:

```bash
pnpm dev            # run just the SvelteKit frontend in a browser
pnpm check          # type-check Svelte + TypeScript
pnpm tauri build    # produce a distributable app bundle
```

### Recommended IDE setup

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).

## Building an unsigned macOS app

The macOS build is unsigned, so after building you need to clear the quarantine attribute before you can open it:

```bash
xattr -cr "/Applications/Daily Work Log.app"
```
