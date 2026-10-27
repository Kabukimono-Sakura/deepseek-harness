# Architecture

Channels normalize incoming messages, check caller access and resolve scoped conversations. A backend adapter runs one turn; a reply dispatcher sends output only to the originating target. Shared persona and explicit identity bindings provide continuity without merging unrelated users.

Planned backends: DSH + DeepSeek API (default), Codex App Server + ChatGPT login, GitHub Copilot SDK + Copilot CLI login. Native thread IDs and execution state remain backend-specific. Switch at a turn boundary; never automatically replay platform writes on another provider.

Planned channels: NapCat OneBot 11; WeChat Official Account callbacks; local desktop pet; Bilibili content and live events. Desktop remains local; public callbacks require their own authentication and account-specific configuration.

OneBot protocol references: [WebSocket](https://github.com/botuniverse/onebot-11/blob/master/communication/ws.md), [message events](https://github.com/botuniverse/onebot-11/blob/master/event/message.md).
