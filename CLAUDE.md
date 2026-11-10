# CLAUDE.md

## Model usage rule (mandatory)

- **Opus is for planning only.** Use the Opus model only to plan work and to question the user about plans: clarifying requirements, weighing approaches, and getting the plan approved.
- **Sonnet writes the code.** Once a plan is approved and work moves to implementation (writing, editing, refactoring or testing code), it must run on Sonnet.

### How to apply

- If the session runs on Opus and implementation begins, hand the coding work to a subagent with `model: "sonnet"` (Agent tool). Give it the approved plan and the relevant file paths so it can work without the planning conversation.
- If you cannot delegate, stop before writing code and ask the user to switch the session model to Sonnet.
- Opus may still read files and run read-only commands to inform a plan, and may review Sonnet's output against the plan. It does not write or edit code itself.
