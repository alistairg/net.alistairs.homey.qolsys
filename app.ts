import Homey from 'homey';
import { QolsysPanelClient } from './lib/QolsysPanelClient';
import { PkiManager } from './lib/PkiManager';

export default class QolsysApp extends Homey.App {

  private _client: QolsysPanelClient | null = null;
  private _clientPanelIp: string | null = null;
  private _pkiManager: PkiManager | null = null;

  async onInit(): Promise<void> {
    this.log('Qolsys IQ Panel app started');
    this._pkiManager = new PkiManager(this.homey);
  }

  getPkiManager(): PkiManager {
    if (!this._pkiManager) {
      this._pkiManager = new PkiManager(this.homey);
    }
    return this._pkiManager;
  }

  getClient(): QolsysPanelClient | null {
    return this._client;
  }

  /**
   * Get-or-create the singleton panel client. Idempotent: returns the
   * existing client if it's already pointed at the same panelIp.
   *
   * The previous implementation always disconnected and re-created the
   * client on each call, which raced with multi-device boot:
   *  - alarm-panel.onInit calls createClient → client A connecting
   *  - zone-sensor.onInit calls getClient → returns A (still connecting)
   *  - second alarm-panel.onInit (or restart) calls createClient again →
   *    disconnects A mid-flight, creates client B
   *  - zone-sensor still holds listener references on A, which now never
   *    fire because A is closed
   *
   * Now: only recreate when panelIp changes (e.g. user updated settings).
   */
  createClient(panelIp: string, pluginIp: string): QolsysPanelClient {
    if (this._client && this._clientPanelIp === panelIp) {
      return this._client;
    }
    if (this._client) {
      this._client.disconnect();
    }
    this._client = new QolsysPanelClient(this.homey, panelIp, this.getPkiManager(), pluginIp);
    this._clientPanelIp = panelIp;
    return this._client;
  }

  async onUninit(): Promise<void> {
    if (this._client) {
      this._client.disconnect();
      this._client = null;
      this._clientPanelIp = null;
    }
  }

}

module.exports = QolsysApp;
