# 0001 — Separate runtime, credentials and channel authority

Date: 2026-10-27. Status: accepted for the prototype.

The repository contains integration code, reproducible checks and documentation. DSH is installed separately under `.runtime/dsh`; runtime state, credentials, sessions and caches stay in ignored project-local directories. Reference PDFs are not republished.

The local bridge uses the shipped `sdk-minimal` profile plus a versioned patch that disables shell, file and working-directory tools. The ordinary Web profile remains an upstream local development UI, not a channel permission boundary. Future external channels must use the restricted bridge and explicit tool policies.

The bridge uses the installed rc.2 protocol: initialize, prompt receipt, session events, wait and resume. There is no per-prompt cancel. A timeout terminates the process and requires reconnecting; no automatic replay is allowed. A successful wait alone is insufficient: a completed terminal event and nonempty assistant text are required.

Conversation identity includes channel, account and target. Backend switching, shared persona and memory export remain separate work; no claim is made that provider-owned sessions are interchangeable.
