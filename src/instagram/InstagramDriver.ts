import { remote } from 'webdriverio';

const INSTAGRAM_PACKAGE = 'com.instagram.android';
const APPIUM_URL = 'http://127.0.0.1:4723';

/** Integração local: não altera dados ou autenticação do Instagram. */
export class InstagramDriver {
  private session: Awaited<ReturnType<typeof remote>> | undefined;

  async checkAppium(): Promise<void> {
    const response = await fetch(`${APPIUM_URL}/status`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Appium /status: HTTP ${response.status}: ${await response.text()}`);
    }
    const status = await response.json() as { value?: { ready?: boolean; message?: string } };
    if (status.value?.ready !== true) {
      throw new Error(`Appium não está pronto: ${JSON.stringify(status)}`);
    }
  }

  async connect(): Promise<void> {
    if (this.session) throw new Error('Já existe uma sessão Appium neste driver.');
    this.session = await remote({
      hostname: '127.0.0.1',
      port: 4723,
      path: '/',
      logLevel: 'error',
      connectionRetryCount: 0,
      connectionRetryTimeout: 120_000,
      capabilities: {
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:deviceName': 'emulator-5554',
        'appium:udid': 'emulator-5554',
        'appium:appPackage': INSTAGRAM_PACKAGE,
        'appium:autoLaunch': false,
        'appium:noReset': true,
        'appium:fullReset': false,
        'appium:forceAppLaunch': false,
        'appium:shouldTerminateApp': false,
        'appium:dontStopAppOnReset': true,
      },
    });
    // Probes de estado ausente devem responder imediatamente no Appium.
    await this.session.setTimeout({ implicit: 0 });
  }

  async openAndConfirmInstagram(): Promise<void> {
    const session = this.session;
    if (!session) throw new Error('Conecte ao Appium antes de abrir o Instagram.');
    await session.activateApp(INSTAGRAM_PACKAGE);
    await session.pause(3_000);
    let currentPackage = '';
    await session.waitUntil(async () => {
      currentPackage = await session.getCurrentPackage();
      return currentPackage === INSTAGRAM_PACKAGE;
    }, {
      timeout: 15_000,
      interval: 1_000,
      timeoutMsg: `Instagram não ficou em primeiro plano (esperado: ${INSTAGRAM_PACKAGE}).`,
    }).catch((error: unknown) => {
      throw new Error(`Último package observado: ${currentPackage || '(não disponível)'}`, { cause: error });
    });
  }

  getSession(): Awaited<ReturnType<typeof remote>> {
    if (!this.session) throw new Error('Não há sessão Appium conectada.');
    return this.session;
  }

  async disconnect(): Promise<void> {
    if (!this.session) return;
    // Apenas DELETE /session: sem terminateApp, reset, uninstall ou logout.
    await this.session.deleteSession();
    this.session = undefined;
  }
}
