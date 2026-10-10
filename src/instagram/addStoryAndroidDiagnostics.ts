import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { InstagramDriver } from './InstagramDriver.js';

type Session = ReturnType<InstagramDriver['getSession']>;
export type AndroidRunner = (device: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
const executeFile = promisify(execFile);
export const runAndroidCommand: AndroidRunner = (device, args) => executeFile(process.env.ADB_PATH || 'adb', ['-s', device, ...args], { timeout: 5_000, windowsHide: true });

export function connectedAndroidDevice(session: Session): string {
  const metadata = session as unknown as { capabilities?: Record<string, unknown>; requestedCapabilities?: Record<string, unknown> };
  const device = metadata.capabilities?.deviceUDID ?? metadata.capabilities?.['appium:udid'] ?? metadata.capabilities?.udid ?? metadata.requestedCapabilities?.['appium:udid'];
  if (typeof device !== 'string' || !/^[a-zA-Z0-9_.:-]+$/.test(device)) throw new Error('UDID da sessão Appium não disponível; comando ADB cancelado.');
  return device;
}

export async function saveAddStoryContext(session: Session, directory: string, name: string, element: Record<string, unknown>, runner: AndroidRunner = runAndroidCommand) {
  const errors: Record<string, string> = {};
  let currentPackage: string | null = null, currentActivity: string | null = null, device: string | null = null;
  let windowDump: { stdout: string; stderr: string } | null = null;
  try { currentPackage = await session.getCurrentPackage(); } catch (error) { errors.currentPackage = String(error); }
  try { currentActivity = await session.getCurrentActivity(); } catch (error) { errors.currentActivity = String(error); }
  try {
    device = connectedAndroidDevice(session);
    windowDump = await runner(device, ['shell', 'dumpsys', 'window']);
  } catch (error) { errors.windowFocus = String(error); }
  const pageSource = await session.getPageSource();
  const pageSourceFile = `${name}.xml`;
  const context = { currentPackage, currentActivity, device, bounds: element.bounds, elementId: element.elementId,
    element, windowFocus: windowDump?.stdout.split(/\r?\n/).filter(line => /mCurrentFocus|mFocusedApp|mTopFocusedDisplayId|topResumedActivity/.test(line)).map(line => line.trim()) ?? [],
    windowDump, pageSourceFile, pageSourceSha256: createHash('sha256').update(pageSource).digest('hex'), errors };
  await writeFile(join(directory, pageSourceFile), pageSource, 'utf8');
  await writeFile(join(directory, `${name}.json`), `${JSON.stringify(context, null, 2)}\n`, 'utf8');
  console.log('[HOME] contexto antes da interação:', JSON.stringify({ currentPackage, currentActivity, device, bounds: context.bounds, elementId: context.elementId, windowFocus: context.windowFocus }));
  return context;
}

export function compareStoryOpenContexts(normal: Record<string, unknown>, withMedia: Record<string, unknown>) {
  const fields = ['currentPackage', 'currentActivity', 'windowFocus', 'bounds', 'elementId', 'pageSourceSha256'];
  const differences = fields.filter(field => JSON.stringify(normal[field]) !== JSON.stringify(withMedia[field]))
    .map(field => ({ field, normal: normal[field] ?? null, withMedia: withMedia[field] ?? null }));
  return { differences, normalErrors: normal.errors ?? {}, withMediaErrors: withMedia.errors ?? {},
    note: 'elementId pode diferir entre sessões; diferenças de hierarquia/foco não comprovam sozinhas a causa.' };
}
