const { execSync } = require('child_process');
const https = require('https');

// --- GitHub Actions helpers (no @actions/core dependency) ---

function getInput(name) {
  return process.env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`] || '';
}

function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    require('fs').appendFileSync(outputFile, `${name}=${value}\n`);
  }
}

function setFailed(message) {
  console.error(`::error::${message}`);
  process.exitCode = 1;
}

// --- GitHub API helper ---

function githubApi(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'User-Agent': 'caliber-action',
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// --- Comment formatting ---

const COMMENT_MARKER = '<!-- caliber-score -->';

function gradeEmoji(grade) {
  const map = { A: '\u2705', B: '\u2705', C: '\u26A0\uFE0F', D: '\u274C', F: '\u274C' };
  return map[grade] || '\u2753';
}

function buildComment(result, baseResult, agent) {
  const lines = [COMMENT_MARKER];
  lines.push(`## ${gradeEmoji(result.grade)} Caliber Score: ${result.score}/100 (${result.grade})`);
  lines.push('');

  if (baseResult) {
    const delta = result.score - baseResult.score;
    const sign = delta > 0 ? '+' : '';
    const icon = delta > 0 ? '\u2B06\uFE0F' : delta < 0 ? '\u2B07\uFE0F' : '\u27A1\uFE0F';
    lines.push(`${icon} **${sign}${delta}** from base branch (${baseResult.score}/100)`);
    lines.push('');
  }

  lines.push(`**Agent:** ${agent}`);
  lines.push('');

  const failing = (result.checks || []).filter((c) => !c.passed);
  if (failing.length > 0) {
    lines.push('### Failing Checks');
    lines.push('');
    lines.push('| Check | Points | Suggestion |');
    lines.push('|-------|--------|------------|');
    for (const check of failing) {
      const suggestion = check.suggestion || check.detail || '';
      lines.push(`| ${check.name || check.id} | ${check.earned}/${check.max} | ${suggestion} |`);
    }
    lines.push('');
  }

  const passing = (result.checks || []).filter((c) => c.passed);
  if (passing.length > 0) {
    lines.push(`<details><summary>\u2705 ${passing.length} passing checks</summary>`);
    lines.push('');
    for (const check of passing) {
      lines.push(`- **${check.name || check.id}**: ${check.earned}/${check.max}`);
    }
    lines.push('</details>');
    lines.push('');
  }

  lines.push('---');
  lines.push('*Powered by [Caliber](https://github.com/rely-ai-org/caliber)*');
  return lines.join('\n');
}

// --- Main ---

async function run() {
  const agent = getInput('agent') || 'claude';
  const failBelow = parseInt(getInput('fail-below') || '0', 10);
  const shouldComment = getInput('comment') !== 'false';
  const autoRefresh = getInput('auto-refresh') === 'true';
  const token = getInput('github-token');

  // Run caliber score
  let resultJson;
  try {
    const output = execSync(`npx --yes @rely-ai/caliber@latest score --json --quiet --agent ${agent}`, {
      encoding: 'utf-8',
      timeout: 120000,
      env: { ...process.env, CALIBER_SKIP_UPDATE_CHECK: '1' },
    });
    resultJson = JSON.parse(output.trim());
  } catch (err) {
    setFailed(`Failed to run caliber score: ${err.message}`);
    return;
  }

  const score = resultJson.score;
  const grade = resultJson.grade;

  console.log(`Score: ${score}/100 (${grade})`);
  setOutput('score', score);
  setOutput('grade', grade);

  // Compare against base branch if on a PR
  let baseResult = null;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  let prNumber = null;
  let repo = null;

  if (eventPath) {
    try {
      const event = JSON.parse(require('fs').readFileSync(eventPath, 'utf-8'));
      prNumber = event.pull_request?.number || null;
      repo = process.env.GITHUB_REPOSITORY;

      if (prNumber) {
        const baseBranch = event.pull_request?.base?.ref;
        if (baseBranch) {
          try {
            const baseOutput = execSync(
              `npx --yes @rely-ai/caliber@latest score --json --quiet --agent ${agent} --compare origin/${baseBranch}`,
              { encoding: 'utf-8', timeout: 120000, env: { ...process.env, CALIBER_SKIP_UPDATE_CHECK: '1' } },
            );
            const parsed = JSON.parse(baseOutput.trim());
            baseResult = parsed.base || null;
          } catch {
            console.log('Could not compute base branch score — skipping comparison.');
          }
        }
      }
    } catch {
      // Not a PR event
    }
  }

  if (baseResult) {
    const delta = score - baseResult.score;
    const sign = delta > 0 ? '+' : '';
    console.log(`Delta: ${sign}${delta} from base (${baseResult.score}/100)`);
    setOutput('delta', `${delta}`);
  }

  // Post PR comment
  if (shouldComment && prNumber && repo && token) {
    const commentBody = buildComment(resultJson, baseResult, agent);
    const commentsPath = `/repos/${repo}/issues/${prNumber}/comments`;

    try {
      // Find existing comment
      const existing = await githubApi('GET', `${commentsPath}?per_page=100`, null, token);
      const prev = (existing.data || []).find((c) => c.body && c.body.includes(COMMENT_MARKER));

      if (prev) {
        await githubApi('PATCH', `/repos/${repo}/issues/comments/${prev.id}`, { body: commentBody }, token);
        console.log('Updated existing PR comment.');
      } else {
        await githubApi('POST', commentsPath, { body: commentBody }, token);
        console.log('Posted PR comment.');
      }
    } catch (err) {
      console.log(`Warning: Could not post PR comment: ${err.message}`);
    }
  }

  // Auto-refresh
  if (autoRefresh) {
    try {
      execSync('npx --yes @rely-ai/caliber@latest refresh --quiet', {
        encoding: 'utf-8',
        timeout: 300000,
        env: { ...process.env, CALIBER_SKIP_UPDATE_CHECK: '1' },
      });

      const changes = execSync('git diff --name-only', { encoding: 'utf-8' }).trim();
      if (changes) {
        execSync('git config user.name "caliber[bot]"');
        execSync('git config user.email "caliber-bot@users.noreply.github.com"');
        execSync('git add CLAUDE.md AGENTS.md .cursorrules .cursor/ .claude/ CALIBER_LEARNINGS.md 2>/dev/null || true');
        execSync('git commit -m "[caliber] auto-refresh agent configs"');
        execSync('git push');
        console.log('Auto-refreshed and committed config changes.');
      } else {
        console.log('No config changes to commit.');
      }
    } catch (err) {
      console.log(`Warning: Auto-refresh failed: ${err.message}`);
    }
  }

  // Fail if below threshold
  if (failBelow > 0 && score < failBelow) {
    setFailed(`Score ${score}/100 is below the minimum threshold of ${failBelow}.`);
  }
}

run().catch((err) => {
  setFailed(`Unexpected error: ${err.message}`);
});
