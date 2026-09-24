#!/usr/bin/env node
// PostToolUse hook on ExitPlanMode — fires the moment Mark approves a plan.
//
// Mark's rule: every approved plan is saved, read-only, to the _audit/ folder of this site's
// tracking folder in his private vault. Plan mode can write only the plan file, so that save is
// always deferred past the moment of approval — and a deferred step is a forgotten step. This
// removes the forgetting, not the judgement (the slug and revision number are the session's call).
// Ported from the vault's own reminder hook.

import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

let plan = '<none found in ~/.claude/plans>';
try {
  const dir = join(homedir(), '.claude', 'plans');
  plan =
    readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => join(dir, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? plan;
} catch {
  // no plans directory — keep the placeholder
}

const context = `PLAN-AUDIT RULE — DO THIS BEFORE ANY OTHER WORK.

Save a read-only copy of the approved plan to the private vault (see CLAUDE.md → "Plan audit"):

  newest plan file: ${plan}
  destination:      mmaggitti/markmaggitti-playground → "10 output/mmaggitti-github-io/_audit/"
  branch:           claude/mmaggitti-github-io-plans  (never main, never force)

Name it:
  <YYYY-MM-DD> approved-plan <slug>.md     first plan for that piece of work
  <YYYY-MM-DD> revision-N <slug>.md        updates a plan already saved there

chmod 444 it. _audit/ is append-only: never rename, edit or delete anything already there.
The plan goes to the VAULT, never into this public repo.`;

process.stdout.write(
  JSON.stringify({
    systemMessage: 'Plan approved — save a read-only copy to the vault _audit/ now.',
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context },
  }) + '\n',
);
