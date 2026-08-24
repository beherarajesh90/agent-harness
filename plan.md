# ForgeGate — Agent Harness Hackathon Plan

## 1. Executive Summary

ForgeGate is an invariant-driven production-change verification agent.

Given a proposed pull request, ForgeGate does not merely review the diff or run the existing test suite. It investigates what must remain true in the application, generates adversarial scenarios designed to violate those business invariants, executes the scenarios in a TrueForge sandbox, produces evidence, and returns a decision:

- `READY` — the tested invariants survived the available experiments.
- `BLOCKED` — an invariant violation was reproduced.
- `UNCERTAIN` — the available evidence is insufficient for a safe decision.

When a failure is found, ForgeGate drafts a regression test and minimal patch, sends the change through Qodo for independent review, processes Qodo’s findings, reruns the tests and adversarial experiment, and requests human approval before writing to GitHub or deploying.

### Product promise

> Don’t trust a code change because the tests pass. Let an agent try to break it first.

### Product category

Invariant-driven failure discovery and proof for high-risk production changes.

### Working name

**ForgeGate**

## 2. Hackathon Context

Official materials:

- [Hackathon overview](https://www.wemakedevs.org/hackathons/trueforge)
- [Schedule](https://www.wemakedevs.org/hackathons/trueforge/schedule)
- [Rules](https://www.wemakedevs.org/hackathons/trueforge/rules)
- [Resources](https://www.wemakedevs.org/hackathons/trueforge/resources)
- [TrueForge documentation](https://trueforge.dev/introduction)
- [TrueForge repository](https://github.com/truefoundry/trueforge)
- [Qodo code-review documentation](https://docs.qodo.ai/code-review)

### Event

- Online hackathon: August 24–30, 2026.
- Teams: solo or up to four people.
- Submission deadline: August 30, 2026 at 8:00 PM London time.
- Required submission: public repository, clear README, approximately three-minute demo video, and short write-up.
- Project must be built during the hackathon period.
- AI coding assistants are allowed but must be disclosed.
- Only authorized tools, accounts, and data may be connected.

### Judging criteria

The six criteria are equally weighted:

1. Potential impact.
2. Creativity and originality.
3. Technical excellence.
4. Use of sponsor tools.
5. Control and safety.
6. Presentation.

ForgeGate should make each criterion visible in the product and demo rather than treating the UI as a decorative layer.

## 3. Why ForgeGate Instead of Ordinary Code Review

Traditional AI code review asks whether the implementation appears correct.

ForgeGate asks whether the changed system continues to preserve its business guarantees under hostile or unusual conditions.

### Distinction

| Ordinary code review | ForgeGate |
|---|---|
| Reads the diff | Reads the diff, architecture, schemas, tests, and operational context |
| Finds likely code issues | Discovers candidate business invariants |
| Suggests tests | Generates adversarial scenarios designed to violate invariants |
| Reports possible risk | Executes the scenario and produces evidence |
| May suggest a patch | Produces a regression test and minimal patch |
| Usually ends at review | Re-runs the experiment and requires approval before writes |

The differentiator is not “AI-generated tests.” Autonomous testing products already exist. The defensible wedge is executable, evidence-backed verification of business invariants for a proposed change.

## 4. Target User and Product Value

### Primary users

- SREs and platform engineers.
- Backend and database engineers.
- Release managers.
- Engineering teams operating payments, billing, inventory, identity, or other high-consequence workflows.

### Core user request

> Can I safely merge or deploy this pull request?

### Product value

- Finds failure modes humans did not explicitly write tests for.
- Converts business rules into executable safety checks.
- Reduces the chance of production incidents caused by retries, concurrency, ordering, or partial failure.
- Gives reviewers evidence instead of a probabilistic risk score.
- Preserves an audit trail of hypotheses, experiments, findings, fixes, reviews, and approvals.

## 5. Core Demonstration Domain

The MVP should use one deliberately small payment service.

### System model

- Payment API.
- Payment-provider stub.
- Payment state machine.
- Ledger database.
- Webhook handler.
- Retry worker.
- Public test repository containing the application and the proposed pull request.

### Primary invariant

> One payment intent must produce exactly one charge and exactly one ledger entry.

### Supporting invariants

- A retry must be idempotent.
- A duplicate webhook must not create a second charge.
- Payment state must not move backwards.
- A failed payment must not be recorded as settled.
- Ledger totals must reconcile with provider charges.

### Proposed bad change

The pull request changes retry behavior and accidentally removes or weakens idempotency handling.

### Adversarial scenario

```text
payment request
→ provider timeout
→ application retry
→ duplicate webhook
→ concurrent retry
```

### Expected evidence

```text
Payment intents: 100
Provider charges: 101 or 102
Ledger entries: 100
Invariant: violated
Decision: BLOCKED
```

The experiment must be deterministic enough to reproduce the failure in the demo.

## 6. ForgeGate Agent Workflow

```text
User asks: “Can I safely deploy PR #42?”
        ↓
Load PR and repository context through GitHub MCP
        ↓
Map changed components and affected flows
        ↓
Discover candidate invariants with evidence
        ↓
Generate adversarial hypotheses
        ↓
Run experiments in TrueForge sandbox
        ↓
Collect traces, metrics, and invariant results
        ↓
Return READY / BLOCKED / UNCERTAIN
        ↓
If BLOCKED: draft regression test and minimal patch
        ↓
Human approval before repository write
        ↓
Qodo reviews the commit or pull request
        ↓
ForgeGate reads and classifies Qodo findings
        ↓
Agent updates the patch if needed
        ↓
Rerun tests and adversarial experiments
        ↓
Qodo reviews the follow-up commit
        ↓
Final human approval before merge or deployment
```

### Evidence hierarchy

1. Reproduced invariant violation.
2. Passing or failing executable experiment.
3. Deterministic regression test.
4. Repository and schema evidence.
5. Agent hypothesis or explanation.

The UI must visually distinguish proven evidence from agent reasoning and unresolved assumptions.

## 7. TrueForge Responsibilities

TrueForge is the runtime layer. ForgeGate should use it rather than recreate it.

### TrueForge should handle

- Agent loop and model calls.
- MCP tool access.
- Sandbox code, file, and shell execution.
- Tool approval checkpoints.
- Agent questions.
- Dynamic subagents.
- Session persistence and reconnects.
- Streaming event delivery.
- Structured output where useful.
- Generative UI primitives where useful.

### ForgeGate should build

- Invariant discovery instructions and evidence format.
- Scenario-generation procedure.
- Payment failure-injection harness.
- Experiment runner and invariant oracle.
- Decision model: `READY`, `BLOCKED`, `UNCERTAIN`.
- Regression-test and patch workflow.
- Qodo finding ingestion and repair loop.
- Product-facing Control Room UI.
- Demo repository and deterministic data.

TrueForge exposes the necessary agent/session/turn/event model, tool approvals, sandbox events, subagent threads, and reconnect support through its API and TypeScript SDK.

## 8. MCP Design

The agent should have a small, explicit tool surface.

### Read tools

- `github.get_pull_request`
- `github.get_changed_files`
- `github.get_file`
- `github.get_review_comments`
- `github.get_check_runs`
- `repo.get_architecture_context`
- `experiment.get_baseline`
- `experiment.get_invariants`

### Sandbox-facing operations

- Build the application.
- Start the payment fixture.
- Generate concurrent requests.
- Inject provider timeout and duplicate webhook conditions.
- Run the invariant checker.
- Run regression tests.
- Produce logs and result artifacts.

### Write tools

- `github.create_branch`
- `github.commit_patch`
- `github.create_or_update_pull_request`
- `github.comment_on_pull_request`
- Optional demo deployment action.

All write/destructive tools must be approval-gated. Read-only analysis can proceed autonomously.

### Custom MCP server

If an existing connector cannot expose the local payment fixture cleanly, create one small custom MCP server backed by real local processes and seeded data. Do not hardcode fake tool-call transcripts.

## 9. Qodo Workflow

Qodo is an independent quality gate, not an agent dependency and not a decorative sponsor integration.

### Correct loop

```text
ForgeGate finds invariant violation
→ drafts test and patch
→ approval before GitHub write
→ Qodo reviews new commit
→ ForgeGate reads Qodo findings via GitHub
→ classifies actionable vs non-actionable findings
→ fixes actionable findings
→ reruns regression test and adversarial experiment
→ approval before follow-up write
→ Qodo reviews again
→ final merge-ready result
```

Qodo may also suggest or apply fixes, but ForgeGate should own the repair decision because the patch must be validated against the business invariant, not only code-quality rules.

### Qodo track strategy

- Install Qodo at the beginning of the hackathon.
- Use multiple real pull requests or meaningful commits.
- Preserve the review history.
- Respond to findings before merging.
- Show one Qodo finding and the resulting retest in the demo.

Qodo is required for the Best Code Quality track; it is not required for the other tracks, but ForgeGate will use it because it strengthens both the quality story and the sponsor-tool story.

## 10. UI Direction: ForgeGate Control Room

The UI should showcase the harness, not hide it behind a chat window.

### Design goal

The interface should make a judge feel that they are watching a live engineering investigation unfold:

```text
context → hypotheses → experiments → evidence → repair → independent review → approval
```

### Primary layout

#### Header: decision context

- ForgeGate logo/name.
- PR number and title.
- Repository and commit SHA.
- Current decision state: `RUNNING`, `READY`, `BLOCKED`, or `UNCERTAIN`.
- Elapsed time and experiment count.
- Compact “human control required” indicator.

#### Left rail: investigation stages

A vertical progression with active, completed, and blocked states:

1. Pull request context.
2. Architecture map.
3. Candidate invariants.
4. Failure hypotheses.
5. Sandbox experiments.
6. Evidence.
7. Repair.
8. Qodo review.
9. Approval.
10. Final decision.

Each stage should be clickable after completion and should open the corresponding evidence panel.

#### Center: live investigation canvas

The main area shows the current action as a dynamic sequence, not a static dashboard.

Examples:

- GitHub file cards being inspected.
- Invariant cards appearing with evidence links.
- Hypotheses branching into experiment nodes.
- Sandbox execution timeline.
- Live counters for payment intents, charges, retries, and ledger entries.
- A visible invariant equation changing from passing to failing.
- Qodo finding entering the same timeline as an independent review event.

#### Right rail: evidence and decision panel

Show:

- Decision state.
- Invariant under test.
- Expected versus observed values.
- Reproduction command or experiment ID.
- Changed files.
- Severity and business impact.
- Confidence and missing evidence.
- Action buttons only when approval is genuinely required.

#### Bottom: event timeline

Use the real TrueForge event stream to show:

- Model messages.
- MCP initialization.
- Tool calls and responses.
- Sandbox creation.
- Subagent threads.
- Approval-required events.
- Qodo review events.
- Turn completion.

Do not fabricate reasoning text. Display tool activity, event metadata, and concise agent summaries derived from actual events.

### Key visual moment

The most important screen is the invariant failure:

```text
INVARIANT VIOLATED

One payment intent → exactly one charge

Expected charges: 100
Observed charges: 102
Failure path: timeout → retry → duplicate webhook
Evidence: reproducible
Decision: BLOCKED
```

This should be visually dominant without using color alone. Use label, icon, text, and a clear counterexample path.

### Approval experience

The approval view should be explicit and calm:

```text
ForgeGate wants to commit a regression test and patch to PR #42.

Files changed: 2
Invariant result: passing after patch
Qodo status: 1 medium finding addressed
Remaining risk: none observed in available experiments

[Review diff] [Approve commit] [Reject]
```

The human should always know what action is being approved, what evidence supports it, and what remains uncertain.

### UI states

Implement and visually test:

- Empty state: no PR selected.
- Loading state: connecting to TrueForge.
- Running state: live events and stage progression.
- Paused state: approval or user question required.
- Blocked state: invariant violation with evidence.
- Repair state: patch and test generation.
- Qodo review state: findings and re-review.
- Ready state: all required gates passed.
- Uncertain state: insufficient evidence and explicit reason.
- Error state: connector, model, sandbox, or stream failure.
- Reconnect state: session restored with event history intact.

### UI quality requirements

- Keyboard-accessible controls.
- Visible focus states.
- No color-only status communication.
- Responsive layout at 320px, 768px, 1024px, and 1440px.
- Respect reduced-motion preferences.
- Use semantic headings and live regions for event updates.
- Avoid generic purple AI styling, excessive rounded cards, and dashboard clutter.
- Prefer one high-information canvas over many decorative panels.

## 11. Judging Strategy

| Judging criterion | ForgeGate proof | UI proof |
|---|---|---|
| Potential impact | Duplicate payment or ledger corruption prevented | Business impact shown in dollars/counts and decision state |
| Creativity | Agent derives invariants and invents adversarial scenarios | Invariant-to-counterexample visualization |
| Technical excellence | Reproducible sandbox, deterministic oracle, regression patch | Evidence drill-down and resilient event timeline |
| Sponsor tools | TrueForge runs MCP, sandbox, subagents, sessions, approvals; Qodo reviews PRs | Visible event trace and Qodo review loop |
| Control and safety | No repository/deployment write without approval | Explicit approval card with exact action and evidence |
| Presentation | Clear three-minute failure-and-recovery narrative | Live Control Room with one obvious “wow” moment |

## 12. Three-Minute Demo Script

### 0:00–0:20 — Problem

Show the PR:

> “Can I safely deploy this payment retry change?”

Show the business invariant:

> One payment intent must produce exactly one charge.

### 0:20–0:55 — Context discovery

ForgeGate visibly:

- Connects to GitHub through MCP.
- Reads the changed retry code.
- Inspects the payment state machine and ledger schema.
- Presents the candidate invariant with evidence.

### 0:55–1:20 — Scenario generation

The agent explains:

> “The changed retry path may duplicate charges when a provider timeout is followed by a duplicate webhook.”

Show the hypothesis branching into an experiment.

### 1:20–1:45 — Failure

Sandbox runs the test.

Show:

```text
100 payment intents
102 charges
100 ledger entries

INVARIANT VIOLATED
DECISION: BLOCKED
```

### 1:45–2:10 — Repair

ForgeGate generates:

- A regression test.
- A minimal idempotency patch.
- The updated experiment result.

### 2:10–2:30 — Qodo

Qodo reviews the commit and produces a finding. ForgeGate reads the finding, fixes it, and reruns the test and adversarial scenario.

### 2:30–2:50 — Approval

TrueForge pauses before the GitHub write:

> “Commit regression test and patch to PR #42?”

The user reviews and approves.

### 2:50–3:00 — Outcome

Show:

```text
1,000 payment simulations
1,000 charges
1,000 ledger entries
Qodo: addressed
Decision: READY
```

Closing line:

> ForgeGate did not just review the change. It found a failure mode, reproduced it, repaired it, and proved the repair.

## 13. Feasibility and Cost

### TrueForge

- Open-source MIT license.
- No TrueForge license fee.
- Local mode uses SQLite and requires no Postgres or Redis.
- Hosted mode uses Docker Compose or Kubernetes with Postgres and Redis.

### External costs

- Model API key, unless event credits are available.
- Sandbox provider cost if using Daytona.
- No need for paid TrueFoundry Gateway for the hackathon.
- No need for live cloud infrastructure in the MVP.

### Windows constraint

Native Windows currently produces a TrueForge startup failure involving the local sandbox fallback and Windows ESM paths.

Use WSL2 Ubuntu or Docker Linux containers. Do not make native Windows execution part of the project’s acceptance criteria.

### Feasible demo environment

- WSL2 Ubuntu.
- Node.js 22+.
- TrueForge local or Docker mode.
- Public GitHub repository.
- Seeded payment fixture.
- Custom local MCP server if needed.
- Daytona only if local Linux sandbox execution is insufficient.

## 14. MVP Scope

### In scope

- One public payment fixture repository.
- One proposed retry/idempotency PR.
- One primary invariant.
- Three failure injectors: timeout, duplicate webhook, concurrent retry.
- GitHub MCP read and approval-gated write.
- TrueForge sandbox execution.
- Deterministic invariant checker.
- `READY`, `BLOCKED`, and `UNCERTAIN` decisions.
- Regression test and minimal patch generation.
- Qodo review → ForgeGate repair → retest loop.
- ForgeGate Control Room UI.
- Three-minute demo path.
- Public README and architecture diagram.

### Explicitly out of scope

- Arbitrary production deployment.
- Arbitrary repository and language support.
- Full chaos-engineering platform.
- Real payment provider credentials.
- Real customer or production data.
- Autonomous merge or deployment.
- Generic risk scoring without executable evidence.
- Multi-tenant SaaS infrastructure.
- Full domain-independent invariant discovery.
- Mobile app.
- Custom replacement for TrueForge’s chat UI and runtime.

## 15. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Invariant discovery hallucinates | High | Require repository/schema evidence; label candidates; use `UNCERTAIN` when unsupported |
| Sandbox cannot provide desired network fault injection | High | Implement a local payment-provider stub with deterministic failure controls |
| Agent generates an unsafe patch | High | Require regression test, Qodo review, experiment rerun, and human approval |
| Qodo review is delayed or unavailable | Medium | Keep Qodo evidence as a separate track; demo a recorded or pre-completed review trail only if permitted, otherwise use live PR review |
| GitHub OAuth or MCP setup fails | Medium | Use a public demo repository and a bounded connector configuration; keep local fixture access separate |
| Demo becomes too long | High | One PR, one invariant, three failure modes, one repair loop |
| UI becomes a generic dashboard | Medium | Center the event-driven investigation canvas and invariant counterexample |
| Native Windows blocks development | High | Use WSL2 or Docker Linux from the start |
| Generated code cannot be explained | High | Keep code minimal, document decisions, and disclose AI assistance |

## 16. Definition of Done

ForgeGate is ready for submission when:

- [ ] A judge can clone the public repository and follow the README.
- [ ] TrueForge visibly calls a real MCP connector.
- [ ] TrueForge visibly provisions and uses the sandbox.
- [ ] The agent discovers and explains the payment invariant.
- [ ] The seeded bad PR produces a reproducible invariant violation.
- [ ] The UI shows the failure evidence and `BLOCKED` decision.
- [ ] ForgeGate generates a regression test and minimal patch.
- [ ] Qodo reviews the change through a real pull request.
- [ ] ForgeGate processes Qodo findings and reruns the experiment.
- [ ] The UI shows an approval pause before repository or deployment write.
- [ ] The corrected scenario reaches `READY`.
- [ ] The UI demonstrates MCP, sandbox, subagent/session, Qodo, and approval states.
- [ ] The demo fits approximately three minutes.
- [ ] No secrets, personal data, or unauthorized accounts appear in the repo or video.
- [ ] AI coding assistance is disclosed.

## 17. Build Order

### Phase 1 — Feasibility proof

- Confirm TrueForge runs in WSL2 or Linux Docker.
- Connect a model.
- Connect GitHub MCP or a minimal custom MCP server.
- Run one session and capture streamed events.
- Prove sandbox execution.
- Prove one approval-gated write.

### Phase 2 — Deterministic payment laboratory

- Create the safe baseline payment service.
- Add the intentionally unsafe retry change.
- Add timeout, duplicate webhook, and concurrency injection.
- Add invariant oracle and stable result output.

### Phase 3 — ForgeGate agent loop

- PR context extraction.
- Candidate invariant generation with evidence.
- Hypothesis generation.
- Experiment execution.
- Decision output.
- Regression test and patch generation.

### Phase 4 — Qodo loop

- Install Qodo from the beginning.
- Create meaningful pull requests.
- Trigger and capture Qodo reviews.
- Read findings through GitHub.
- Repair, retest, and request another review.

### Phase 5 — Control Room UI

- Implement stage progression.
- Implement live event timeline.
- Implement invariant and evidence cards.
- Implement sandbox experiment view.
- Implement Qodo review state.
- Implement approval dialog.
- Implement final decision screen.
- Add loading, paused, error, reconnect, and uncertain states.

### Phase 6 — Submission polish

- Freeze the demo scenario.
- Verify clean-clone setup.
- Record the three-minute demo.
- Write the short project explanation.
- Confirm Qodo review history is visible.
- Confirm all secrets and personal data are removed.
- Run the final judge checklist.

## 18. Open Decisions

- Whether the UI runs as a custom application around the TrueForge API or primarily extends the bundled UI.
- Whether local Linux sandbox execution is sufficient or Daytona is required.
- Whether the first patch is generated entirely by ForgeGate or assisted by a controlled coding tool.
- Whether the demo includes a real GitHub PR write or stops at an approval preview.
- Whether to use the name ForgeGate publicly or pair it with “Invariant Hunter” as the product descriptor.

## Final Position

ForgeGate should not be presented as a generic production simulator or autonomous QA platform.

It should be presented as:

> A TrueForge-powered agent that discovers what must remain true in a system, tries to violate those guarantees under adversarial conditions, and refuses to approve a change without executable evidence.

The winning demo is one reproducible duplicate-payment failure, one generated repair, one Qodo review loop, one approval gate, and one clear transition from `BLOCKED` to `READY`.
