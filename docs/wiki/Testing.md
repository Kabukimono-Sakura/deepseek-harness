# Testing

`npm run check` performs TypeScript checking, Node test-runner tests with coverage output, and a tracked-path check for runtime/private files.

GitHub Actions executes this on Windows and Ubuntu with Node 24. Tests use fictitious identities and local/mock services. Real model and platform checks are recorded separately and are never required of public pull requests.

Important behaviors to cover as implemented: user/group isolation, duplicate delivery, FIFO ordering, rejected senders, connection loss, uncertain send outcomes, backend switching during a turn, cancellation, restart persistence and credential redaction.

The tracked-path guard is not a complete secret scanner; review the staged diff before publishing.

`npm run test:runtime` starts the actual DSH Web runtime and checks local authentication. `npm run test:sdk` uses the actual DSH SDK runtime with a loopback-only simulated Messages provider: it checks text output, the absence of coding tools, process restart, and restored conversation history. The SDK test uses its own temporary DSH home and a fictitious key, never the user's `.env`. Both runtime checks run on Windows and Ubuntu in CI. They do not prove live DeepSeek account access.
