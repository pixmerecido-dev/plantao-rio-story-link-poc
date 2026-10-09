import 'dotenv/config';

export function inspectEnvironment() {
  const dryRun = process.env.DRY_RUN;
  return {
    name: 'DRY_RUN',
    present: dryRun !== undefined && dryRun.trim() !== '',
    valid: dryRun === 'true' || dryRun === 'false',
  };
}
