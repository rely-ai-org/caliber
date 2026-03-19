---
name: scoring-checks
description: Adds a new deterministic scoring check to src/scoring/checks/ following the Check interface from src/scoring/index.ts. Use constants from src/scoring/constants.ts for point values. Trigger: user says 'add scoring check', 'new check', 'score X', or modifies src/scoring/. Do NOT use for LLM-based scoring or refining existing checks without test coverage.
---
# Scoring Checks

## Critical

- **Deterministic only**: No LLM calls. Every check runs synchronously with 100% reproducible output.
- **Check interface**: Implement `Check` from `src/scoring/index.ts`: `{ name: string; run(config: CheckConfig): CheckResult }` where `CheckResult = { passed: boolean; points: number; maxPoints: number; details?: string }`.
- **Points from constants**: All point values MUST come from `src/scoring/constants.ts`. Do NOT hardcode numbers.
- **Test before register**: Every new check requires a test before being added to the checks array.
- **Validate CheckConfig**: Each check receives `{ config: IConfig; manifest: Manifest }`. Verify required fields exist before running logic.

## Instructions

1. **Add point constants** to `src/scoring/constants.ts`:

```typescript
export const POINTS_SKILL_FILES_EXIST = 50;
```

2. **Create the check** in the appropriate file under `src/scoring/checks/` (e.g., `src/scoring/checks/existence.ts`):

```typescript
import { Check, CheckConfig, CheckResult } from '../index.js';
import { POINTS_SKILL_FILES_EXIST } from '../constants.js';

export const skillFilesExistCheck: Check = {
  name: 'Skill Files Exist',
  run(config: CheckConfig): CheckResult {
    if (!config.manifest?.skills) {
      return { passed: false, points: 0, maxPoints: POINTS_SKILL_FILES_EXIST };
    }
    const count = config.manifest.skills.length;
    const points = Math.min(count * 10, POINTS_SKILL_FILES_EXIST);
    return {
      passed: points === POINTS_SKILL_FILES_EXIST,
      points,
      maxPoints: POINTS_SKILL_FILES_EXIST,
      details: `${count} skill files found`,
    };
  },
};
```

3. **Write tests** colocated with the scoring module (e.g., alongside `src/scoring/checks/existence.ts`):

```typescript
import { describe, it, expect } from 'vitest';
import { skillFilesExistCheck } from '../checks/existence.js';

describe('skillFilesExistCheck', () => {
  it('passes when skills array has items', () => {
    const result = skillFilesExistCheck.run({
      config: {},
      manifest: { skills: [{}, {}, {}] },
    });
    expect(result.points).toBeGreaterThan(0);
  });

  it('fails when skills array is empty', () => {
    const result = skillFilesExistCheck.run({
      config: {},
      manifest: { skills: [] },
    });
    expect(result.passed).toBe(false);
    expect(result.points).toBe(0);
  });
});
```

4. **Register the check** in `src/scoring/index.ts`:

```typescript
import { skillFilesExistCheck } from './checks/existence.js';
checks.push(skillFilesExistCheck);
```

5. **Run and verify**:

```bash
npx vitest run src/scoring/
npx tsc --noEmit
caliber score
```

## Common Issues

**"Cannot find name 'POINTS_...'"**
- Add constant to `src/scoring/constants.ts` and import it in the check file

**"points exceeds maxPoints in test"**
- Use `Math.min(calculated, maxPoints)` to enforce cap

**"Type 'CheckResult' does not match"**
- All four fields required: `passed` (boolean), `points`, `maxPoints`, `details` (optional)
- `passed` must be `points === maxPoints`, not `points > 0`

**Check not showing in `caliber score`**
- Verify check is added to the `checks` array in `src/scoring/index.ts`
- Run `npm run build` to recompile
