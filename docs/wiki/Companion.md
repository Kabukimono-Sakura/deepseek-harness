# QQ companion behavior

The companion is an optional mode of the existing QQ bridge. Account verification, contact allowlists and conversation isolation still apply. Persona, relationship details, chat archives, generated profile text and image caches remain in ignored `data/` files.

## Local setup

Create `data/companion/persona.md` after agreeing on the character. Create `data/companion/settings.json` with `enabled`, `accountId`, `ownerId` and `proactive`. Both IDs are strings; the owner must already be in the QQ allowlist. Set `proactive` to false to disable unsolicited conversations. With no enabled settings the bridge retains the original text mode. The private persona applies only to the owner's private conversation.

Run `node scripts/companion-stickers.mjs --refresh` to refresh the public [sticker catalog](https://xn--pssy23gqgbz2d718b.com/open-api/v1/index.json). Catalog descriptions guide selection; original images download on demand, retain source/license metadata, and are checked by signature, size and SHA256 when available. Image files are not committed to the repository.

`node scripts/companion-profile.mjs --generate` asks the configured character to write a short QQ bio and saves it locally. `--apply` applies that saved text to the verified account, preserves its nickname, backs up the previous profile and verifies the result. These are explicit maintenance commands, not tools available to an incoming QQ message.

The owner can explicitly ask in private chat to change the companion's avatar. The character chooses a catalog image or an image attached to that message; arbitrary generated URLs are not accepted. A durable action record prevents replay after an ambiguous result or crash. The model receives the actual `set_qq_avatar` result before writing its reply, so it does not claim success based on intent alone. QQ may cache the avatar on other clients. Other contacts, groups and ordinary proactive wakeups cannot request this operation.

## Conversation and memory

The model returns a structured plan of text bubbles and catalog sticker IDs. The bridge records each bubble separately with its delivery receipt. Confirmed bubbles are not repeated after reconnect, and an ambiguous delivery stops that sequence. New user input supersedes remaining old bubbles. A brief input settling period lets successive short messages become one response context while preserving each received message in the archive.

Every model turn uses the private persona, current Shanghai time, recent conversation and relevant older records from SQLite. Chinese character bigrams provide lightweight retrieval without an embedding service. The underlying archive is not truncated when the context budget is reached. Separate conversations never share retrieved history. Delivered, skipped, uncertain and synthetic proactive messages remain distinguishable. Optional self-observations carry the source event and remain revisable, rather than becoming unquestionable facts.

Companion mode creates a fresh DSH session per turn using this archived context. A failed turn does not permanently block later turns; an uncertain send is still never retried automatically. This differs from legacy session-resume mode. The current retriever is an initial implementation: it does not guarantee perfect recall of every archived detail and does not yet provide a memory editor or deletion UI.

## Proactive contact

An application-owned scheduler creates randomized opportunities roughly every one to three hours during 08:00–24:00 Asia/Shanghai. This targets approximately eight opportunities over a full day, with no hard daily quota or fixed follow-up count. Recent conversation postpones an opportunity; the character can choose to remain quiet. Actual outgoing conversations therefore vary. Only the configured owner is contacted.

Due times persist across restart. Overdue opportunities are rescheduled instead of replayed. Offline periods are not backfilled. Proactive events expire, are labeled as internal events, and never pretend to be user messages. The bridge must remain running and QQ must remain logged in; this does not install an OS startup service.

## Images and current limits

Companion mode accepts QQ image segments and uses the official `deepseek-flash` vision API to describe trusted QQ CDN images before generating a reply. See [DeepSeek vision documentation](https://api-docs.deepseek.com/guides/vision/). Failed or unavailable images are explicitly described as unrecognized. Vision observations are stored with their source event and treated as fallible evidence. Signed image URLs stay local; an image is also sent to the configured DeepSeek service for inference. Up to eight images are analyzed per incoming message; the prompt records how many were processed.

The runtime currently offers text, images, scoped retrieval and proactive contact. It does not yet browse videos, read books, play games, process voice, or manage Bilibili/WeChat. Interest details can emerge in conversations, but independent exploration of outside content needs subsequent tools. Private QQ conversations are not projected onto the desktop pet.

If the original GitHub image host is unavailable, the downloader tries the same site's published display image. Original files are checked against the catalog SHA256; display variants are format/size checked and retain a local checksum and source URL. Variants are not incorrectly compared with the original file's hash.

For a graceful Windows stop, write the current `nonce` from `data/qq-bridge.lock.json` to `data/qq-stop.json` as JSON. The bridge finishes generation, preserves any unsent reply, closes its connection and releases its lock. Restart with the normal QQ command. Do not force a restart during an active send.
