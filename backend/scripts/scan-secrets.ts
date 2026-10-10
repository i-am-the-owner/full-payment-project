/**
 * Looks for secrets that should never be in code, configuration examples or a
 * built bundle: private keys, cloud and payment keys, signed tokens, secrets
 * assigned as string literals, and passwords inside connection strings.
 *
 *   node scripts/scan-secrets.ts <dir-or-file>...
 *     e.g. node scripts/scan-secrets.ts src scripts ../mobile/lib ../web/src ../web/.next/static dist
 *
 * Exits 1 when anything is found. Prints the file, line and rule, never the value.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
}

interface Rule {
  readonly name: string;
  readonly pattern: RegExp;
}

const RULES: readonly Rule[] = [
  {
    name: 'private key block',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  },
  { name: 'AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'live payment/API key', pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}/ },
  {
    name: 'chat / VCS token',
    pattern: /\b(?:xox[abprs]-[0-9A-Za-z-]{10,}|gh[pousr]_[0-9A-Za-z]{30,})\b/,
  },
  {
    name: 'signed JWT',
    pattern: /\beyJ[0-9A-Za-z_-]{15,}\.eyJ[0-9A-Za-z_-]{15,}\.[0-9A-Za-z_-]{10,}/,
  },
  {
    name: 'secret assigned as a literal',
    pattern:
      /\b[A-Za-z_]*(?:secret|passw(?:or)?d|api[_-]?key|private[_-]?key|access[_-]?token|client[_-]?secret)[A-Za-z_]*["']?\s*[:=]\s*["'][A-Za-z0-9+/_=.-]{24,}["']/i,
  },
  {
    name: 'password inside a connection string',
    pattern:
      /\b[a-z]+:\/\/[^\s:@/]+:(?!pass(?:word)?@|password@|\$\{|%s)[^\s:@/]{6,}@(?!localhost|127\.0\.0\.1)[\w.-]+/i,
  },
];

/** Values that are public or obviously placeholders. */
const ALLOWED = [
  /dev-only-insecure-secret-change-me/,
  /example/i,
  /placeholder/i,
  /xxx+/i,
  /change-?me/i,
  /BEGIN PUBLIC KEY/,
];

const SKIP_DIRS = new Set(['node_modules', '.git', '.dart_tool', 'coverage']);
const SKIP_FILES =
  /\.(png|jpe?g|gif|ico|webp|avif|woff2?|ttf|otf|so|dylib|jar|class|lock|zip|gz|pdf)$/i;

export function scanText(text: string, file: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    // Minified bundles are one huge line; examine them in windows.
    const windows = line.length > 2000 ? (line.match(/.{1,2000}/g) ?? []) : [line];
    for (const part of windows) {
      for (const rule of RULES) {
        const match = rule.pattern.exec(part);
        if (match && !ALLOWED.some((allowed) => allowed.test(match[0]))) {
          findings.push({ file, line: index + 1, rule: rule.name });
        }
      }
    }
  });
  return findings;
}

export function scanPath(path: string): Finding[] {
  const stats = statSync(path);
  if (stats.isDirectory()) {
    return readdirSync(path)
      .filter((name) => !SKIP_DIRS.has(name))
      .flatMap((name) => scanPath(join(path, name)));
  }
  if (SKIP_FILES.test(path) || stats.size > 20 * 1024 * 1024) {
    return [];
  }
  return scanText(readFileSync(path, 'utf8'), path);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    console.error('Usage: scan-secrets.ts <dir-or-file>...');
    process.exit(2);
  }
  const findings = targets.flatMap((target) => {
    try {
      return scanPath(target);
    } catch {
      console.error(`Skipping ${target}: not found`);
      return [];
    }
  });
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}  ${finding.rule}`);
  }
  console.log(
    findings.length === 0 ? 'No secrets found.' : `${findings.length} possible secret(s) found.`,
  );
  process.exit(findings.length === 0 ? 0 : 1);
}
