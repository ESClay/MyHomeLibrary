# CLAUDE.md

## Model usage rule (mandatory)

- **Opus is for planning only.** Use the Opus model only to plan work and to question the user about plans: clarifying requirements, weighing approaches, and getting the plan approved.
- **Sonnet writes the code.** Once a plan is approved and work moves to implementation (writing, editing, refactoring or testing code), it must run on Sonnet.

### How to apply

- If the session runs on Opus and implementation begins, hand the coding work to a subagent with `model: "sonnet"` (Agent tool). Give it the approved plan and the relevant file paths so it can work without the planning conversation.
- If you cannot delegate, stop before writing code and ask the user to switch the session model to Sonnet.
- Opus may still read files and run read-only commands to inform a plan, and may review Sonnet's output against the plan. It does not write or edit code itself.

## Visual design rule (mandatory)

- Every visual design choice goes through the `design-taste-frontend` skill. That includes layout, typography, color, spacing, components, icons, motion and copy tone, and new screens or restyles of existing ones. The goal is a distinct look, not the default Claude/shadcn UI.
- Invoke the skill (Skill tool, `design-taste-frontend`) before designing or building any UI, and run its checker/finish gate before calling UI work done.
- When UI work is handed to a Sonnet subagent, its prompt must tell it to invoke `design-taste-frontend` first and follow it, and to report the gate result.
- When reviewing UI output, check it against the skill's rules, not only against the plan.
