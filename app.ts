import Homey from 'homey';
import { QolsysPanelClient } from './lib/QolsysPanelClient';
import { PkiManager } from './lib/PkiManager';

export default class QolsysApp extends Homey.App {

  private _client: QolsysPanelClient | null = null;
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

  createClient(panelIp: string, pluginIp: string): QolsysPanelClient {
    if (this._client) {
      this._client.disconnect();
    }
    this._client = new QolsysPanelClient(this.homey, panelIp, this.getPkiManager(), pluginIp);
    return this._client;
  }

  async onUninit(): Promise<void> {
    if (this._client) {
      this._client.disconnect();
      this._client = null;
    }
  }

}

module.exports = QolsysApp;
