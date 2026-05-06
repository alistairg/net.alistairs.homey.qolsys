import Homey from 'homey';
import { PkiManager } from '../../lib/PkiManager';
import { PairingServer } from '../../lib/PairingServer';
import { stripPort } from '../../lib/NetUtil';

import type QolsysApp from '../../app';

export default class AlarmPanelDriver extends Homey.Driver {

  private _alarmTriggeredCard!: Homey.FlowCardTriggerDevice;

  async onInit(): Promise<void> {
    this.log('Alarm Panel driver initialized');

    this._alarmTriggeredCard = this.homey.flow.getDeviceTriggerCard('alarm_triggered');

    const armAwayAction = this.homey.flow.getActionCard('arm_away');
    armAwayAction.registerRunListener(async (args) => {
      await (args.device as any).armAway();
    });

    const armHomeAction = this.homey.flow.getActionCard('arm_home');
    armHomeAction.registerRunListener(async (args) => {
      await (args.device as any).armHome();
    });

    const disarmAction = this.homey.flow.getActionCard('disarm');
    disarmAction.registerRunListener(async (args) => {
      await (args.device as any).disarm();
    });
  }

  triggerAlarm(device: Homey.Device, tokens: { partition_name: string; alarm_type: string }): void {
    this._alarmTriggeredCard.trigger(device, tokens).catch(this.error);
  }

  async onPair(session: Homey.Driver.PairSession): Promise<void> {
    let panelIp = '';
    let pairingServer: PairingServer | null = null;

    const app = this.homey.app as QolsysApp;
    const pkiManager = app.getPkiManager();

    // Clean up pairing server when session ends
    session.setHandler('disconnect', async () => {
      this.log('Pairing session disconnected, cleaning up');
      if (pairingServer) {
        await pairingServer.stopPairing();
        pairingServer = null;
      }
    });

    // Step 1: User enters panel IP
    session.setHandler('configure', async (data: { panelIp: string }) => {
      panelIp = data.panelIp;
      this.log('Configure: panelIp =', panelIp);

      if (panelIp) {
        this.homey.settings.set('panel_ip', panelIp);
      }
    });

    // Step 2: Start pairing (certificate exchange)
    session.setHandler('start_pairing', async () => {
      this.log('start_pairing handler invoked, isPaired:', pkiManager.isPaired());

      // If already paired, skip certificate exchange
      if (pkiManager.isPaired()) {
        this.log('Already paired, skipping certificate exchange');
        session.emit('pairing_status', 'Already paired! Loading devices...');
        return;
      }

      // Generate PKI
      const mac = PkiManager.generateRandomMac();
      this.log('Generating PKI with MAC:', mac);
      const certs = pkiManager.generatePki(mac);
      pkiManager.storePki(certs);
      this.log('PKI stored');

      // Get local IP for mDNS advertisement
      const localAddress = await this.homey.cloud.getLocalAddress();
      const pluginIp = stripPort(localAddress);

      // Clean up any previous pairing server
      if (pairingServer) {
        this.log('Cleaning up previous pairing server');
        await pairingServer.stopPairing();
      }

      // Start pairing server
      pairingServer = new PairingServer(pkiManager, pluginIp, this.log.bind(this));

      pairingServer.on('listening', (port: number) => {
        session.emit('pairing_status', `TLS server listening on port ${port}...`);
      });

      pairingServer.on('advertising', (port: number) => {
        session.emit('pairing_status', `TLS server ready on port ${port} — waiting for panel to connect...`);
      });

      pairingServer.on('panel_disconnected', () => {
        session.emit('pairing_status', 'Panel disconnected, waiting for reconnect...');
      });

      try {
        const result = await pairingServer.startPairing(300000); // 5 min timeout
        panelIp = panelIp || result.panelIp;

        session.emit('pairing_status', 'Certificate exchange complete!');

        // Store panel IP from pairing result
        if (panelIp) {
          this.homey.settings.set('panel_ip', panelIp);
        }
      } catch (err) {
        await pairingServer.stopPairing();
        throw err;
      }
    });

    // Step 3: List partition devices
    session.setHandler('list_devices', async () => {
      // Use stored panel IP if not set in this session
      if (!panelIp) {
        panelIp = this.homey.settings.get('panel_ip') || '';
      }
      this.log('list_devices handler invoked, isPaired:', pkiManager.isPaired(), 'panelIp:', panelIp);

      if (!pkiManager.isPaired()) {
        this.log('list_devices: not paired, returning empty');
        return [];
      }

      if (!panelIp) {
        throw new Error('Panel IP not configured');
      }

      // Get local IP
      const localAddress = await this.homey.cloud.getLocalAddress();
      const pluginIp = stripPort(localAddress);
      this.log('list_devices: pluginIp:', pluginIp);

      // Connect to panel and sync database
      this.log('list_devices: creating client for', panelIp);
      const client = app.createClient(panelIp, pluginIp);

      this.log('list_devices: connecting...');
      await client.connect();

      // Wait for connected event with timeout
      this.log('list_devices: waiting for connected event, isConnected:', client.isConnected);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.log('list_devices: connection timed out after 30s');
          reject(new Error('Timed out waiting for panel connection'));
        }, 30000);

        if (client.isConnected) {
          this.log('list_devices: already connected');
          clearTimeout(timeout);
          resolve();
        } else {
          client.once('connected', () => {
            this.log('list_devices: connected event received');
            clearTimeout(timeout);
            resolve();
          });
          client.once('disconnected', () => {
            this.log('list_devices: disconnected event received');
            clearTimeout(timeout);
            reject(new Error('Panel connection failed'));
          });
        }
      });

      const state = client.databaseState;
      this.log('list_devices: databaseState partitions:', state?.partitions.size ?? 'null');
      if (!state || state.partitions.size === 0) {
        this.log('list_devices: no partitions found, returning empty');
        return [];
      }

      // Build device list from partitions
      const devices: any[] = [];
      for (const [partitionId, partition] of state.partitions) {
        this.log('list_devices: partition', partitionId, partition.name);
        devices.push({
          name: partition.name || `Partition ${partitionId}`,
          data: {
            id: `partition_${partitionId}`,
            partitionId,
          },
          store: {
            panelIp,
            pluginIp,
          },
          settings: {
            panel_ip: panelIp,
            partition_id: partitionId,
          },
        });
      }

      this.log('list_devices: returning', devices.length, 'devices');
      return devices;
    });
  }

}

module.exports = AlarmPanelDriver;
