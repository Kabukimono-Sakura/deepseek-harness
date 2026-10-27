# Deepseek Harness implementation plan

Updated: 2026-10-27. Independent companion project; not the official DeepSeek Harness repository.

## Confirmed scope

- Windows local prototype; all project files and runtime data under `D:\Deepseek Harness` on the development machine.
- Personal QQ using NapCat / OneBot 11, not the official QQ bot identity.
- WeChat Official Account, desktop pet, Bilibili content and live-danmaku integration.
- Default DeepSeek official API; Codex ChatGPT login and GitHub Copilot login as selectable agent backends.
- Shared persona and scoped memory; public/group conversations must not inherit private conversations.
- Public GitHub repository with CI, issue-based sprint tracking and documentation.

## Milestones and definition of done

| Milestone | Deliverable | Done when |
|---|---|---|
| M0 Foundation | D-drive environment, GitHub, CI, reproducible checks | Migration verified; Windows/Linux CI green; runtime boots |
| M1 Local conversation | DeepSeek + durable conversation + pet | Real model turn succeeds; restart retains conversation; pet shows status/reply |
| M2 Personal QQ | Authenticated OneBot transport | Live private/group messages work; dedup, reconnect, cancellation tested |
| M3 Backend switching | Codex and Copilot adapters | Each authenticates and completes real turns; switching preserves scoped context |
| M4 Bilibili | Content tools, comments/dynamics and live events | Each capability verified independently; no misleading claims about unavailable content |
| M5 Official Account | Verified callback and permitted reply path | Real account callback/reply works; retries and long-running tasks handled |
| M6 Integrated prototype | Settings, memory, quotas and distribution | End-to-end checklist passes; cache bounded; onboarding documented |

## Working method

Use small issues with acceptance criteria. Keep one active sprint milestone; label work `status:todo`, `status:in-progress`, `status:blocked`, or `status:done`. Record architecture changes in `docs/decisions/`. Update this plan when evidence changes an assumption.

CI runs without live credentials. Passing a mock test is not evidence of real platform connectivity. Do not deploy platform-facing services automatically before their account-specific configuration exists.

## Current blockers

## Verification record — 2026-10-27

- Portable Node 24.22.1 and DSH 0.2.1-rc.2 installed in the D-drive project.
- Local TypeScript checking and 15 offline tests passed.
- Real DSH Web smoke passed: loopback listener, anonymous HTTP 401, authenticated HTML HTTP 200. No model call was made.
- Restricted SDK bridge and local CLI implemented; real inference and restart continuity still await API-key configuration.
- Public repository, seven milestones and eight acceptance-based issues created. Remote CI results are recorded in GitHub Actions.

## Remaining account setup

No user API keys or platform logins have been configured in this project. Build and test independent pieces first; collect credentials through local setup when the corresponding integration is ready.
