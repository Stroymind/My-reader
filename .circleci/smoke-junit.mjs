// Runs each discovered test atom and writes a JUnit report, so the smoke suite
// produces results on the Tests tab even though scripts/smoke.mjs has no reporter.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [report, ...atoms] = process.argv.slice(2);
let failures = 0;

const cases = atoms.map(atom => {
  const started = Date.now();
  const { status } = spawnSync(process.execPath, [atom], { stdio: 'inherit' });
  const seconds = ((Date.now() - started) / 1000).toFixed(3);
  if (status !== 0) failures++;
  const failure = status === 0 ? '' : `<failure message="exit ${status}"/>`;
  return `<testcase classname="${atom}" name="${atom}" file="${atom}" time="${seconds}">${failure}</testcase>`;
});

mkdirSync(dirname(report), { recursive: true });
writeFileSync(report, `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="smoke" tests="${atoms.length}" failures="${failures}">
${cases.join('\n')}
</testsuite>
`);
process.exit(failures === 0 ? 0 : 1);
