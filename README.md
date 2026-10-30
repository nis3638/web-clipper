<h1 align="center">Web Clipper</h1>
<p align="center">
    <a href="https://github.com/webclipper/web-clipper/actions">
      <img src="https://github.com/webclipper/web-clipper/workflows/CI%20Test/badge.svg" alt="CI Test Status">
    </a>
     <a href="https://github.com/webclipper/web-clipper/actions">
      <img src="https://github.com/webclipper/web-clipper/workflows/Release resource/badge.svg" alt="Release resource status">
    </a>
    <a href="https://codecov.io/gh/webclipper/web-clipper">
      <img src="https://img.shields.io/codecov/c/github/webclipper/web-clipper/master.svg?style=flat-square" alt="Codecov">
    </a>
</p>

Web Clipper saves anything on the web to the note-taking app or service you choose.

<img src="https://clipper.website/static/image/screenshot.png">

## Supported Services

- [FlowUs](https://flowus.cn/)
- [Obsidian](https://obsidian.md/)
- [GitHub](https://github.com)
- [Yuque](https://www.yuque.com)
- [Buildin.AI](https://buildin.ai/product)
- [Notion](https://www.notion.so/)
- [Youdao](https://note.youdao.com/)
- [OneNote](https://www.onenote.com/)
- [Bear](https://bear.app)
- [Joplin](https://joplinapp.org/)
- [Server Chan](http://sc.ftqq.com/3.version)
- [dida365](https://dida365.com/)
- [baklib](https://www.baklib-free.com/)
- [wolai](https://www.wolai.com/)
- [Leanote](https://github.com/leanote/leanote)
- [Flomo](https://flomoapp.com/)
- [Siyuan](https://b3log.org/siyuan)
- [Ulysses](https://ulysses.app/)
- [Confluence](https://www.atlassian.com/software/confluence)

Images can be uploaded to image hosting providers such as GitHub, Imgur, sm.ms, QCloud, and PicList.

## Install

- [Chrome Web Store](https://chrome.google.com/webstore/detail/web-clipper/mhfbofiokmppgdliakminbgdgcmbhbac)
- [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/opejamnnohhbjflpbhnmdlknhjkfhfdp)

The store review takes about a week, so the store version can lag behind the latest release.

### Install from GitHub

1. Download `web-clipper-<version>-chrome.zip` from the [releases page](https://github.com/webclipper/web-clipper/releases).
2. Open `chrome://extensions/` and turn on **Developer mode** in the top right.
3. Unzip the file.
4. Click **Load unpacked** and select the unzipped folder.

## Notion

The Notion integration uses your existing Notion login. It does not need an API key or an integration token.

### Setup

1. Log in to [Notion](https://www.notion.so/) in the same browser where Web Clipper is installed.
2. Open Web Clipper, choose **Notion** as the service, and add the account.
3. Web Clipper checks both `app.notion.com` and `www.notion.so` for a valid session. It uses whichever origin accepts your login.

If you see an "Unauthorized! Please Login Notion Web." message, open Notion in the browser, confirm you are logged in, then try again.

### Choosing where clips go

After authentication, Web Clipper loads your workspaces and lists the pages you can write to, plus database pages. Pick one as the destination. A clip is created as a new child page under a regular page. For a database destination, the new page is attached to that database.

- Workspaces are discovered from your account data. If a workspace has no visible pages, Web Clipper falls back to a Notion search to find writable pages.
- If one workspace fails to load, the others still appear.

### How clips are written

Notion no longer accepts the older import task format, so Web Clipper converts each clip to Notion blocks on your machine and saves them directly, in the same way the Notion web app does.

- The page is created first, then its content blocks are written in one transaction.
- The first top-level heading that matches the clip title is removed to avoid a duplicate title.
- Notion page links use the workspace ID and page ID returned after saving.

Markdown is converted as follows:

| Markdown | Notion block |
| --- | --- |
| `#`, `##`, `###`+ | Heading 1, Heading 2, Heading 3 |
| `- item`, `* item` | Bulleted list (nested by indentation) |
| `1. item` | Numbered list |
| `- [ ] task`, `- [x] task` | To-do (checked or unchecked) |
| `> quote` | Quote |
| ` ``` lang ` | Code block, with the language when recognized |
| `---`, `***`, `___` | Divider |
| `![alt](url)` | Image |
| `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, `[link](url)` | Inline styles and links |

Anything that does not match these patterns is saved as a plain paragraph.

### Troubleshooting Notion

- **Unauthorized / not logged in**: log in to Notion in this browser, then retry. Web Clipper reads the cookies Notion sets for `app.notion.com` and `www.notion.so`, so a session in another browser will not work.
- **No destination pages listed**: make sure the account can edit at least one page in the workspace. Read-only pages are not offered as destinations.
- **Clip fails with a request error**: the error message includes Notion's response body. Include it when you report a bug.

## Develop

```bash
$ git clone https://github.com/webclipper/web-clipper.git
$ cd web-clipper
$ npm i
$ npm run dev
```

- Load the `dist/chrome` folder in Chrome (`chrome://extensions/` → **Load unpacked**).
- For Firefox, load `dist/manifest.json`.

### Project layout

- `src/common/backend/services/` — one folder per destination service. Notion lives in `notion/`:
  - `index.ts` — service metadata and permissions
  - `origin.ts` — Notion origins and the login probe across origins
  - `service.ts` — authentication, workspace discovery, and clip writing
  - `repository.ts` — builds destination lists from Notion record maps
  - `markdown.ts` — Markdown to Notion block conversion
  - `types.ts` — Notion API response types
- `src/common/backend/clients/` — clients for other services (GitHub, Joplin, Siyuan, Leanote).
- `src/common/backend/imageHosting/` — image hosting providers.
- `src/common/locales/data/` — UI translations.

## Test

```bash
$ npm run test      # run the test suite once
$ npm run cov       # run with coverage
```

The Notion tests cover origin probing, cookie scoping, workspace and page discovery, Markdown conversion, and operation generation (`service.test.ts`, `repository.test.ts`, `origin.test.ts`, `markdown.test.ts`).

## Format

```bash
$ npm run format
```

## Release

Release notes are kept in `release/` and in `src/services/environment/common/changelog/`.

## Feedback

Please open an issue on GitHub for bugs or feature requests. Include the service name, the steps to reproduce, and any error message shown in the extension.

| Type     | Link                                                 |
| -------- | ---------------------------------------------------- |
| Telegram | [Link](https://t.me/joinchat/HoVttRRUIA6aXASixzoqAw) |

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
