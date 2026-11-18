// Runs a command with a Java 21+ runtime first on PATH, which the Firebase
// emulators need. Looks at JAVA_HOME, PATH, ~/.jdks/* and the usual Windows
// install folders, so an older Java earlier on PATH (Oracle's java8path) does
// not win. Fails fast with an install hint when there is none.
//
//   node tool/with-java21.mjs <command> [args...]
//
// One-time setup without an installer or admin rights: extract the Temurin 21
// zip (https://adoptium.net/temurin/releases/?version=21) to ~/.jdks/temurin-21.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

const MIN = 21;
const exe = process.platform === 'win32' ? 'java.exe' : 'java';

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
let found = null;
for (const bin of candidates) {
  const java = join(bin, exe);
  if (!existsSync(java)) continue;
  const v = major(java);
  seen.push(`${java} (${v || '?'})`);
  if (v >= MIN) {
    found = bin;
    break;
  }
}

if (!found) {
  console.error(`The Firebase emulators need Java ${MIN}+. Found: ${seen.join(', ') || 'no java'}.`);
  console.error('Extract the Temurin 21 zip (https://adoptium.net/temurin/releases/?version=21) to ~/.jdks/temurin-21, or set JAVA_HOME.');
  process.exit(1);
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.log(found);
  process.exit(0);
}
const quote = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
// Windows names it Path; set whichever key exists so the child sees one PATH.
const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
const env = { ...process.env, [pathKey]: `${found}${delimiter}${process.env[pathKey] ?? ''}`, JAVA_HOME: join(found, '..') };
const r = spawnSync([cmd, ...args].map(quote).join(' '), { stdio: 'inherit', shell: true, env });
process.exit(r.status ?? 1);
