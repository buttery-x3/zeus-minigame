# Zeus Minigame Agent Notes

This project is a personal proof-of-concept for an isometric 3D storm-mage arena game.

## Stack

- Use Three.js, TypeScript, Vite, and plain HTML/CSS.
- Do not reintroduce Phaser or a second rendering/game framework without an explicit user request.
- Keep the first screen as the playable game, not a landing page.

## Commands

```bash
npm install
npm run dev
npm run build
npm run verify
```

The dev server normally runs at `http://127.0.0.1:5173/`.

In Codex on Windows, `npm run build` and `npm run verify` fail in the sandbox with Vite `[commonjs--resolver] spawn EPERM`. Run these commands with escalation in the first instance instead of trying a sandboxed run first.

Run `npm run verify` after changing gameplay, HUD, camera, input, scene setup, rendering, or core styles. If behavior changes intentionally, update `scripts/verify-render.mjs` and `docs/TESTING.md` in the same patch.

## Git Workflow

- Start any code or docs change by checking `git status -sb` so the current branch and uncommitted work are understood.
- Treat pre-existing uncommitted changes as user-owned unless the user clearly says otherwise. Do not revert, overwrite, or tidy them as part of unrelated work.
- `docs/DEPLOYMENT.md` is intentionally ignored and local-only. Do not flag that ignore rule or the untracked deployment runbook as a review issue.
- Never run destructive git operations such as `git reset --hard`, branch deletion, force-push, rebase, or checkout/restore of user changes without explicit user approval.
- Keep `main` clean and releasable. Use feature branches to isolate non-trivial work before editing.
- Default branch name format for agent-created branches is `codex/<short-task-slug>`.
- Prefer a new feature branch for gameplay, rendering, input, HUD, scene setup, verification, multi-file, risky, or experimental changes.
- Staying on the current branch is fine for read-only investigation, tiny docs edits, or changes the user explicitly wants applied where they are.
- If the worktree is dirty, summarize the existing changes before creating or switching branches.
- Make commits only after the change is coherent and relevant verification has run. Keep commits small and focused.
- Do not push, open a pull request, merge to `main`, or delete branches unless the user asks for that step.

When the user asks for a plan, include a short `Git Handling` item that covers:

- Current branch and worktree state.
- Whether a new feature branch is recommended and why.
- Whether commits are expected.
- Whether pushing, PR creation, or merging should wait for explicit approval.

Example:

```md
Git Handling:
- Current branch: main, worktree clean.
- Recommend creating codex/lightning-targeting-fix before edits because this touches gameplay and verification.
- Commit after npm run verify passes.
- Do not push or merge unless requested.
```

## Coordinate Conventions

- Gameplay uses the Three.js `X/Z` ground plane.
- `Y` is vertical height.
- Grid cells map to world `x/z`, not screen pixels.
- Use `distance2D` for ground-plane distances.

## Architecture Rules

- Keep `src/main.ts` as bootstrapping only.
- Put durable gameplay systems under `src/game`.
- Put world/grid/procedural terrain concerns under `src/world`.
- Put Three.js rendering helpers under `src/render`.
- Put DOM HUD code under `src/ui`.
- Put small framework-neutral helpers under `src/lib`.
- Prefer files below roughly 250 lines. A larger file is acceptable only while actively splitting a feature.
- Keep render verification current as new default gameplay functionality is added.

## Gameplay Direction

- The core feel is Dota-like targeted spellcasting in an isometric arena.
- Movement is click or hold-to-move only, no WASD by default.
- `Q` is Chain Lightning and `W` is Lightning Bolt.
- Enemies are simple melee chasers until a specific feature expands them.
- Preserve the grid/world foundation for future obstacle generation and WFC experiments.
