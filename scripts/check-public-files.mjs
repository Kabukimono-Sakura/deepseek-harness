import { execFileSync } from 'node:child_process';

// Defense against accidentally adding runtime data to this public repository.
// It checks file paths; it is not a full secret scanner.
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const denied = files.filter(path =>
  /(^|\/)(node_modules|\.dsh|\.runtime|\.cache|\.tools|data|tmp|相关文档)(\/|$)/.test(path)
  || /(^|\/)\.env($|\.)/.test(path) && path !== '.env.example'
  || path === 'config/local.json'
  || /(^|\/)(auth|credentials|cookies)\.json$/i.test(path)
);
if (denied.length) {
  console.error('Private/runtime paths are tracked:\n' + denied.join('\n'));
  process.exitCode = 1;
} else console.log(`Public-file check passed (${files.length} tracked paths).`);
