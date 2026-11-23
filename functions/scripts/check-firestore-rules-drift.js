// Fails when firestore.rules differs from the ruleset production serves.
// Read-only: calls the Firebase Rules API and never deploys anything.
//
// From functions/:
//   npm run check:rules-drift                    # compares ../firestore.rules
//   npm run check:rules-drift -- --rules <file>  # compares another file (replays)
// Auth resolution order:
//   1. FIREBASE_RULES_ACCESS_TOKEN
//   2. Firebase CLI login token in ~/.config/configstore/firebase-tools.json
//   3. `gcloud auth print-access-token`
//   4. GOOGLE_APPLICATION_CREDENTIALS (CI service account / ADC)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const admin = require('firebase-admin');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'lunaexpress';
const API = 'https://firebaserules.googleapis.com/v1';
const DEFAULT_RULES = path.resolve(__dirname, '../../firestore.rules');

function normalize(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map((line) => line.trimEnd());
  return `${lines.join('\n').trim()}\n`;
}

async function accessToken() {
  if (process.env.FIREBASE_RULES_ACCESS_TOKEN) return process.env.FIREBASE_RULES_ACCESS_TOKEN;

  try {
    const cfgCandidates = [
      process.env.XDG_CONFIG_HOME && path.join(process.env.XDG_CONFIG_HOME, 'configstore', 'firebase-tools.json'),
      path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'),
      process.env.APPDATA && path.join(process.env.APPDATA, 'configstore', 'firebase-tools.json'),
    ].filter(Boolean);
    const cfgPath = cfgCandidates.find((p) => fs.existsSync(p));
    if (cfgPath) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg.tokens?.refresh_token) {
        const candidates = [
          path.resolve(__dirname, '../../node_modules/firebase-tools/lib/auth'),
          'firebase-tools/lib/auth',
        ];
        for (const modPath of candidates) {
          try {
            const auth = require(modPath);
            const res = await auth.getAccessToken(cfg.tokens.refresh_token, cfg.tokens.scopes || []);
            if (res?.access_token) return res.access_token;
          } catch {
            // Try next candidate
          }
        }
      }
    }
  } catch {
    // Fall through to gcloud / ADC
  }

  try {
    const cmd = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
    const tok = execFileSync(cmd, ['auth', 'print-access-token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (tok) return tok;
  } catch {
    // Fall through to ADC
  }

  return (await admin.credential.applicationDefault().getAccessToken()).access_token;
}

async function getJson(url, token) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT_ID },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}\n${await res.text()}`);
  return res.json();
}

function lineDiff(repo, live) {
  const repoLines = new Set(repo.split('\n'));
  const liveLines = new Set(live.split('\n'));
  const onlyRepo = [...repoLines].filter((line) => line.trim() && !liveLines.has(line));
  const onlyLive = [...liveLines].filter((line) => line.trim() && !repoLines.has(line));
  return [...onlyRepo.map((line) => `- ${line}`), ...onlyLive.map((line) => `+ ${line}`)].join('\n');
}

async function main() {
  const flag = process.argv.indexOf('--rules');
  const rulesPath = flag === -1 ? DEFAULT_RULES : path.resolve(process.argv[flag + 1]);
  const repo = normalize(fs.readFileSync(rulesPath, 'utf8'));

  const token = await accessToken();
  const release = await getJson(`${API}/projects/${PROJECT_ID}/releases/cloud.firestore`, token);
  const ruleset = await getJson(`${API}/${release.rulesetName}`, token);
  const file =
    ruleset.source.files.find((f) => f.name === 'firestore.rules') || ruleset.source.files[0];
  const live = normalize(file.content);

  if (repo === live) {
    console.log(`OK: ${rulesPath} matches production ${release.rulesetName} (updated ${release.updateTime}).`);
    return;
  }
  console.error(
    `DRIFT: ${rulesPath} differs from production ${release.rulesetName} (updated ${release.updateTime}).`,
  );
  console.error('Lines only in the repo (-) or only in production (+):');
  console.error(lineDiff(repo, live) || '(same lines in a different order or with different whitespace)');
  process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Could not compare rules: ${err.message}`);
    process.exitCode = 2;
  });
}

module.exports = { accessToken, getJson, normalize, PROJECT_ID };
