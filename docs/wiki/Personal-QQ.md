# Personal QQ prototype

The bridge uses authenticated OneBot 11 forward WebSocket on loopback. It checks `get_login_info` against `qq.accountId` before accepting any event. The QQ account, test contacts and tokens belong only in ignored local files.

## Configuration

Copy `config/prototype.example.json` to `config/local.json` if it does not already exist. Set `qq.accountId`, `allowedUsers` and, only when needed, `allowedGroups`. An empty group list disables group conversations. Group messages also require a structured mention of the agent. Keep `qq.enabled` false until NapCat is configured.

Put `DEEPSEEK_API_KEY` and a random `ONEBOT_ACCESS_TOKEN` in `.env`. Configure NapCat with a WebSocket server on `127.0.0.1:3001`, array message format, and the same OneBot token. Keep WebUI on `127.0.0.1:6099`, with its own independent token.

The Windows helper `scripts/napcat-configure.mjs` writes private configuration to `data/napcat/config`. Existing OneBot settings are preserved. The local launcher uses the official portable Windows Node release under `.runtime/napcat-node-v4.18.41`, with bundled QQ native dependencies. It does not terminate an existing personal QQ session. See the [official release](https://github.com/NapNeko/NapCatQQ/releases/tag/v4.18.41) and [installation guide](https://napneko.github.io/guide/boot/Shell).

```powershell
.\scripts\napcat-install.ps1
.\scripts\napcat-start.ps1
```

The installer verifies the fixed release's SHA256 before extraction. The launcher starts a hidden background process, puts NapCat work files and its child process profile under `data/napcat`, and records the PID in `tmp/napcat-node.pid`. WebUI's token is in `data/napcat/config/webui.json`; do not share it. The user's normal QQ installation/profile is separate. The DLL-based Shell launcher failed with a missing entry module on the development machine; the upstream portable Node package successfully reached QR login on 2026-10-29.

For an expiring QR image, run `node scripts/qq-login.mjs` and open the address saved in `tmp/qq-login-url.txt` in your local browser. This temporary viewer reads the current PNG every two seconds, uses an unpredictable URL, listens only on loopback, and stops after 15 minutes. It does not perform QQ authentication. Do not share its URL or image. The current account successfully completed manual login and the bridge's account verification on 2026-10-29.

After manually completing QQ login, set `qq.enabled` to true and run:

```powershell
.\scripts\dev.ps1 run qq
```

The bridge prints `authenticated account verified` only after a successful account check. Send a short plain-text message from an allowed test contact. `reply-confirmed` means OneBot returned a successful send result with a message ID; additionally verify receipt on the contact's QQ client. Press Ctrl+C to stop the bridge. This does not log out or stop QQ.

## Delivery and recovery

`data/qq.sqlite` stores conversation/session mappings, incoming text and replies. Duplicate events do not trigger another model call. Processing is FIFO, with a maximum of 100 pending messages and 10 admitted new messages per minute. Private and group conversations have separate identities. Replies are always bound to the original target; generated CQ markup remains ordinary text.

A completed reply waits locally while the transport is disconnected. A send with an unknown outcome is marked `uncertain` and is never automatically repeated. A crash during generation blocks that conversation for local review, because the model history may already have advanced. Review the database locally; the prototype does not yet provide a recovery UI or an automatic retry command. Never blindly reset a `sending`/`uncertain` row to resend it.

The model runtime has no filesystem or shell tools. Only plain text is supported. Replies longer than 4000 characters are retained locally and replaced on QQ with an explicit length-limit notice. Attachments, temporary conversations and anonymous group messages are ignored. The bridge does not project private QQ text onto the desktop pet.

## Acceptance status

Offline transport and database tests cover account mismatch, event isolation, duplicate delivery, FIFO sessions, reconnect, lost receipts, crash recovery and removed contacts. These tests do not establish a live QQ connection. Real login and contact-side receipt must be verified separately. Groups remain unverified until an explicitly authorized test group exists.
