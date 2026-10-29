# Testing

`npm run check` performs TypeScript checking, Node test-runner tests with coverage output, and a tracked-path check for runtime/private files.

GitHub Actions executes this on Windows and Ubuntu with Node 24. Tests use fictitious identities and local/mock services. Real model and platform checks are recorded separately and are never required of public pull requests.

Important behaviors to cover as implemented: user/group isolation, duplicate delivery, FIFO ordering, rejected senders, connection loss, uncertain send outcomes, backend switching during a turn, cancellation, restart persistence and credential redaction.

The tracked-path guard is not a complete secret scanner; review the staged diff before publishing.

The companion iteration adds tests for structured output validation, per-bubble reconnect and uncertain delivery, superseded replies, failed image preparation, Chinese archive retrieval, contact isolation, daytime wakeups, restart backlog, expired proactive work and image URL/vision failures. All 44 offline tests passed locally on 2026-10-29. Separate live checks verified the model-authored QQ bio, archived-word recall, text/image delivery receipts and official DeepSeek vision on the delivered image. Avatar authorization, image-source validation and non-replay after an uncertain profile operation are also tested. A real avatar update received a successful QQ acknowledgment. Human feedback on conversational tone is tracked separately from protocol correctness. Child RPC processes deliberately killed by transport tests explicitly clear NODE_V8_COVERAGE (Node automatically restores a missing key); an environment regression test verifies this, avoiding empty child reports on Windows CI.

`npm run test:live` explicitly uses the local DeepSeek key and incurs API usage. It checks a real reply and recall after restarting DSH, then writes a private acceptance record to `data/live-check/last-result.json`. It is never invoked by CI. This live check passed on the development machine on 2026-10-28.

`npm run test:runtime` starts the actual DSH Web runtime and checks local authentication. `npm run test:sdk` uses the actual DSH SDK runtime with a loopback-only simulated Messages provider: it checks text output, the absence of coding tools, process restart, and restored conversation history. The SDK test uses its own temporary DSH home and a fictitious key, never the user's `.env`. Both runtime checks run on Windows and Ubuntu in CI. They do not prove live DeepSeek account access.
