// Runs a command with a Java 21+ runtime first on PATH, which the Firebase
// emulators need. Looks at JAVA_HOME, PATH, ~/.jdks/* and the usual Windows
// install folders, so an older Java earlier on PATH (Oracle's java8path) does
// not win. Fails fast with an install hint when there is none.
//
//   node tool/with-java21.mjs <command> [args...]
//   node tool/with-java21.mjs --ephemeral-emulators <command> [args...]
//
// One-time setup without an installer or admin rights: extract the Temurin 21
// zip (https://adoptium.net/temurin/releases/?version=21) to ~/.jdks/temurin-21.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MIN = 21;
const exe = process.platform === 'win32' ? 'java.exe' : 'java';
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function major(javaBin) {
  // `java -version` prints to stderr.
  const r = spawnSync(javaBin, ['-version'], { encoding: 'utf8' });
  return parse(`${r.stderr ?? ''}${r.stdout ?? ''}`);
}

function parse(text) {
  const m = /version "(\d+)(?:\.(\d+))?/.exec(text);
  if (!m) return 0;
  return m[1] === '1' ? Number(m[2]) : Number(m[1]);
}

function subdirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(dir, d.name));
  } catch {
    return [];
  }
}

/** Allocates `names.length` distinct free TCP ports on 127.0.0.1 simultaneously. */
export async function allocateFreePorts(names) {
  const servers = [];
  const ports = {};
  try {
    for (const name of names) {
      const srv = createServer();
      await new Promise((resolve, reject) => {
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', resolve);
      });
      servers.push(srv);
      ports[name] = srv.address().port;
    }
    return ports;
  } finally {
    await Promise.all(
      servers.map((srv) => new Promise((resolve) => srv.close(() => resolve()))),
    );
  }
}

/** Clones firebase.json with ephemeral localhost emulator ports so concurrent worktrees never collide. */
export function buildEphemeralFirebaseConfig(baseConfig, ports) {
  const baseEmulators = baseConfig.emulators ?? {};
  return {
    ...baseConfig,
    emulators: {
      ...baseEmulators,
      auth: { ...(baseEmulators.auth ?? {}), host: '127.0.0.1', port: ports.auth },
      firestore: { ...(baseEmulators.firestore ?? {}), host: '127.0.0.1', port: ports.firestore },
      functions: { ...(baseEmulators.functions ?? {}), host: '127.0.0.1', port: ports.functions },
      hub: { ...(baseEmulators.hub ?? {}), host: '127.0.0.1', port: ports.hub },
      logging: { ...(baseEmulators.logging ?? {}), host: '127.0.0.1', port: ports.logging },
      ui: { enabled: false },
    },
  };
}

/** Inserts `--config <configPath>` immediately after `emulators:exec` or `emulators:start`. */
export function injectConfigArg(args, configPath) {
  if (args.includes('--config') || args.includes('-c')) return args;
  const idx = args.findIndex((arg) => arg === 'emulators:exec' || arg === 'emulators:start');
  if (idx === -1) return args;
  return [...args.slice(0, idx + 1), '--config', configPath, ...args.slice(idx + 1)];
}

export function findJava21() {
  const homes = [
    process.env.JAVA_HOME,
    ...subdirs(join(homedir(), '.jdks')),
    ...(process.platform === 'win32'
      ? ['Eclipse Adoptium', 'Java', 'Microsoft', 'Zulu'].flatMap((v) => subdirs(join(process.env.ProgramFiles ?? 'C:\\Program Files', v)))
      : []),
  ].filter(Boolean);
  const candidates = [
    ...homes.map((h) => join(h, 'bin')),
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
  ];

  const seen = [];
  for (const bin of candidates) {
    const java = join(bin, exe);
    if (!existsSync(java)) continue;
    const v = major(java);
    seen.push(`${java} (${v || '?'})`);
    if (v >= MIN) return { found: bin, seen };
  }
  return { found: null, seen };
}

async function main() {
  const { found, seen } = findJava21();
  if (!found) {
    console.error(`The Firebase emulators need Java ${MIN}+. Found: ${seen.join(', ') || 'no java'}.`);
    console.error('Extract the Temurin 21 zip (https://adoptium.net/temurin/releases/?version=21) to ~/.jdks/temurin-21, or set JAVA_HOME.');
    process.exit(1);
  }

  const rawArgs = process.argv.slice(2);
  const ephemeral = rawArgs[0] === '--ephemeral-emulators';
  const [cmd, ...restArgs] = ephemeral ? rawArgs.slice(1) : rawArgs;
  if (!cmd) {
    console.log(found);
    process.exit(0);
  }

  // Windows names it Path; set whichever key exists so the child sees one PATH.
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const env = { ...process.env, [pathKey]: `${found}${delimiter}${process.env[pathKey] ?? ''}`, JAVA_HOME: join(found, '..') };

  let finalArgs = restArgs;
  let tmpConfig = null;
  const cleanup = () => {
    if (tmpConfig) {
      try { rmSync(tmpConfig, { force: true }); } catch {}
      tmpConfig = null;
    }
  };

  if (ephemeral) {
    const ports = await allocateFreePorts(['auth', 'firestore', 'functions', 'hub', 'logging']);
    const baseConfig = JSON.parse(readFileSync(join(repoRoot, 'firebase.json'), 'utf8'));
    const config = buildEphemeralFirebaseConfig(baseConfig, ports);
    tmpConfig = join(repoRoot, `.firebase-ephemeral-${process.pid}-${Date.now()}.json`);
    writeFileSync(tmpConfig, `${JSON.stringify(config, null, 2)}\n`);
    finalArgs = injectConfigArg(restArgs, tmpConfig);
    env.FUNCTIONS_EMULATOR_HOST = `127.0.0.1:${ports.functions}`;
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  }

  const quote = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
  try {
    const r = process.platform === 'win32'
      ? spawnSync([cmd, ...finalArgs].map(quote).join(' '), { stdio: 'inherit', shell: true, env })
      : spawnSync(cmd, finalArgs, { stdio: 'inherit', env });
    process.exitCode = r.status ?? 1;
  } finally {
    cleanup();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
