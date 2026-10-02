// Runs the whole test suite under several time zones.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const zones = [
  'UTC',
  'Asia/Seoul', // no DST, +09:00
  'America/New_York', // DST at 02:00
  'Europe/London', // DST, offset 0 in winter
  'Australia/Lord_Howe', // 30-minute DST shift
  'Asia/Kathmandu', // +05:45
  'Pacific/Chatham', // +12:45 / +13:45
  'America/Santiago', // DST transition at midnight
  'Asia/Beirut', // DST transition at midnight
  'Pacific/Kiritimati', // +14:00
  'Pacific/Pago_Pago', // -11:00
];

const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));

let failed = 0;
for (const tz of zones) {
  const result = spawnSync(process.execPath, [vitest, 'run', '--reporter=dot'], {
    env: { ...process.env, TZ: tz, FUZZ_RUNS: '200' },
    encoding: 'utf8',
  });
  const summary = (result.stdout || '').split('\n').find((line) => line.includes('Tests')) || '';
  const ok = result.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${tz.padEnd(22)} ${summary.trim()}`);
  if (!ok) console.log(result.stdout, result.stderr);
}

if (failed) {
  console.error(`\n${failed} time zone(s) failed.`);
  process.exit(1);
}
console.log('\nAll time zones passed.');
