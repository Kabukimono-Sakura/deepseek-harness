# Testing

`npm run check` performs TypeScript checking, Node test-runner tests with coverage output, and a tracked-path check for runtime/private files.

GitHub Actions executes this on Windows and Ubuntu with Node 24. Tests use fictitious identities and local/mock services. Real model and platform checks are recorded separately and are never required of public pull requests.

Important behaviors to cover as implemented: user/group isolation, duplicate delivery, FIFO ordering, rejected senders, connection loss, uncertain send outcomes, backend switching during a turn, cancellation, restart persistence and credential redaction.

The tracked-path guard is not a complete secret scanner; review the staged diff before publishing.
