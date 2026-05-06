import { EventEmitter } from 'events';
import tls from 'tls';
import mqtt, { MqttClient, IClientOptions } from 'mqtt';
import { v4 as uuidv4 } from 'uuid';
import Homey from 'homey/lib/Homey';
import { PkiManager } from './PkiManager';
import { DatabaseParser, DatabaseState, DbChangedEvent } from './DatabaseParser';
import {
  QolsysPartitionData,
  QolsysZoneData,
  QolsysPanelInfo,
  PartitionSystemStatus,
  PartitionAlarmState,
  PartitionArmingType,
} from './types';

const TOPIC_PUBLISH = 'mastermeid';
const TOPIC_IQ2MEID = 'iq2meid';

const MQTT_PORT = 8883;
const PING_INTERVAL_MS = 600_000; // 600 seconds
const COMMAND_TIMEOUT_MS = 30_000; // 30 seconds

// Reconnection backoff
const RECONNECT_INITIAL_MS = 5_000;
const RECONNECT_MAX_MS = 120_000;

/**
 * MQTT client for communicating with a Qolsys IQ Panel.
 * Manages connection lifecycle, reconnection, and command dispatch.
 *
 * Emits:
 *   'connected'
 *   'disconnected'
 *   'zone_update'       — { zoneId: string, data: QolsysZoneData }
 *   'partition_update'  — { partitionId: string, data: QolsysPartitionData }
 *   'alarm_event'       — { partitionId: string, alarmState: string, alarmType: string }
 *
 * Reference: QolsysController/qolsys_controller/controller.py
 */
export class QolsysPanelClient extends EventEmitter {

  private homey: Homey;
  private panelIp: string;
  private macAddress: string;
  private formattedMac: string;
  private pkiManager: PkiManager;
  private dbParser: DatabaseParser;
  private pluginIp: string;

  private client: MqttClient | null = null;
  private _connected: boolean = false;
  private _destroyed: boolean = false;

  private state: DatabaseState | null = null;
  private pendingRequests: Map<string, {
    resolve: (data: Record<string, any>) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }> = new Map();

  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay: number = RECONNECT_INITIAL_MS;

  constructor(homey: Homey, panelIp: string, pkiManager: PkiManager, pluginIp: string) {
    super();
    this.homey = homey;
    this.panelIp = panelIp;
    this.pkiManager = pkiManager;
    this.macAddress = pkiManager.macId;
    this.formattedMac = pkiManager.formattedMac;
    this.pluginIp = pluginIp;
    this.dbParser = new DatabaseParser();
  }

  get isConnected(): boolean {
    return this._connected;
  }

  /** Current database state (partitions + zones). Null until first sync. */
  get databaseState(): DatabaseState | null {
    return this.state;
  }

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  /** Connect to the panel's MQTT broker with mTLS. */
  async connect(): Promise<void> {
    if (this._destroyed) return;
    if (this.client) return;

    const tlsCerts = this.pkiManager.getTlsOptions();
    const clientId = `qolsys-controller-${this.formattedMac}`;
    const responseTopic = `response_${this.formattedMac}`;

    const secureContext = tls.createSecureContext({
      key: tlsCerts.key,
      cert: tlsCerts.cert,
      ca: tlsCerts.ca,
      minVersion: 'TLSv1.2',
      ciphers: 'DEFAULT:@SECLEVEL=0', // Qolsys CA uses SHA-1
    });

    const opts = {
      host: this.panelIp,
      port: MQTT_PORT,
      protocol: 'mqtts' as const,
      key: tlsCerts.key,
      cert: tlsCerts.cert,
      ca: tlsCerts.ca,
      // Validate the server cert against the CA we received during pairing
      // — that's the whole point of mutual TLS. The panel's cert CN is
      // 'www.qolsys.com' (with a trailing space) and won't match the
      // panel's LAN IP, so we override checkServerIdentity to skip the
      // hostname check while keeping the chain validation.
      rejectUnauthorized: true,
      checkServerIdentity: () => undefined,
      secureContext,
      clientId,
      clean: true,
      keepalive: 60,
      reconnectPeriod: 0, // we handle reconnection ourselves
    };

    this.log('Connecting to panel MQTT broker...');

    this.client = mqtt.connect(opts);

    this.client.on('connect', async () => {
      this.log('MQTT connected');
      this.reconnectDelay = RECONNECT_INITIAL_MS;

      // Subscribe to topics
      this.client!.subscribe(TOPIC_IQ2MEID);
      this.client!.subscribe(responseTopic);

      try {
        await this.postConnectSequence();
        this._connected = true;
        this.emit('connected');
        this.startPingTimer();
      } catch (err) {
        this.log('Post-connect sequence failed:', err);
        this.handleDisconnect();
      }
    });

    this.client.on('message', (topic: string, payload: Buffer) => {
      try {
        const data = JSON.parse(payload.toString());

        if (topic === responseTopic) {
          this.handleCommandResponse(data);
        } else if (topic === TOPIC_IQ2MEID) {
          this.handleIq2meidMessage(data);
        }
      } catch (err) {
        this.log('Error processing MQTT message:', err);
      }
    });

    this.client.on('error', (err) => {
      this.log('MQTT error:', err.message);
    });

    this.client.on('close', () => {
      if (this._connected) {
        this.handleDisconnect();
      }
    });

    this.client.on('offline', () => {
      if (this._connected) {
        this.handleDisconnect();
      }
    });
  }

  /** Disconnect and clean up. Does not reconnect. */
  disconnect(): void {
    this._destroyed = true;
    this.stopPingTimer();
    this.stopReconnectTimer();
    this.rejectAllPending('Client disconnected');

    if (this.client) {
      this.client.end(true);
      this.client = null;
    }

    if (this._connected) {
      this._connected = false;
      this.emit('disconnected');
    }
  }

  // ---------------------------------------------------------------------------
  // Post-connect sequence
  // ---------------------------------------------------------------------------

  /**
   * After MQTT connect + subscribe, run the handshake sequence:
   * 1. connect_v204 — register with panel
   * 2. pingevent — announce active status
   * 3. pair_status_request — verify pairing
   * 4. syncdatabase — fetch full state
   */
  private async postConnectSequence(): Promise<void> {
    // Step 1: connect_v204
    const connectResponse = await this.sendCommand('connect_v204', {
      ipAddress: this.pluginIp,
      pairing_request: true,
      macAddress: this.formattedMac,
      remoteClientID: `qolsys-controller-${this.formattedMac}`,
      softwareVersion: '4.4.1',
      productType: 'tab07_rk68',
      bssid: '',
      lastUpdateChecksum: '2132501716',
      dealerIconsCheckSum: '',
      remote_feature_support_version: '1',
      current_battery_status: 'Normal',
      remote_panel_battery_percentage: 100,
      remote_panel_battery_temperature: 430,
      remote_panel_battery_status: 3,
      remote_panel_battery_scale: 100,
      remote_panel_battery_voltage: 4102,
      remote_panel_battery_present: true,
      remote_panel_battery_technology: '',
      remote_panel_battery_level: 100,
      remote_panel_battery_health: 2,
      remote_panel_plugged: 1,
      dhcpInfo: JSON.stringify({
        ipaddress: '', gateway: '', netmask: '',
        dns1: '', dns2: '', dhcpServer: '', leaseDuration: '',
      }),
    });

    // Extract panel info from connect response
    if (this.state?.panelInfo) {
      this.state.panelInfo.imei = connectResponse.master_imei || '';
      this.state.panelInfo.productType = connectResponse.primary_product_type || '';
    }

    // Step 2: pingevent
    await this.sendPingEvent();

    // Step 3: pair_status_request
    await this.sendCommand('pair_status_request', {});

    // Step 4: syncdatabase
    const dbResponse = await this.sendCommand('syncdatabase', {});
    if (dbResponse.fulldbdata) {
      this.state = this.dbParser.parseFullDatabase(dbResponse.fulldbdata);

      // Apply panel info from connect response
      if (connectResponse.master_imei) {
        this.state.panelInfo.imei = connectResponse.master_imei;
      }
      if (connectResponse.primary_product_type) {
        this.state.panelInfo.productType = connectResponse.primary_product_type;
      }

      this.log(`Synced: ${this.state.partitions.size} partitions, ${this.state.zones.size} zones`);
    }
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /** Arm a partition. */
  async armPartition(
    partitionId: string,
    armingType: PartitionArmingType,
  ): Promise<Record<string, any> | null> {
    const armingCommand = {
      operation_name: armingType,
      bypass_zoneid_set: '[]',
      userID: 0,
      partitionID: parseInt(partitionId, 10),
      exitSoundValue: 'OFF',
      entryDelayValue: 'ON',
      multiplePartitionsSelected: false,
      instant_arming: false,
      final_exit_arming_selected: false,
      manually_selected_zones: '[]',
      operation_source: 1,
      macAddress: this.formattedMac,
    };

    return this.sendIpcPanelCommand([{
      dataType: 'string',
      dataValue: JSON.stringify(armingCommand),
    }]);
  }

  /** Disarm a partition. Varies by current partition state. */
  async disarmPartition(
    partitionId: string,
  ): Promise<Record<string, any> | null> {
    const partition = this.state?.partitions.get(partitionId);
    if (!partition) {
      this.log(`Disarm error: unknown partition ${partitionId}`);
      return null;
    }

    // Determine disarm command based on current state
    let mqttDisarmCommand: string;

    if (partition.alarmState === PartitionAlarmState.ALARM) {
      mqttDisarmCommand = 'disarm_from_emergency';
    } else if ([
      PartitionSystemStatus.ARM_AWAY_EXIT_DELAY,
      PartitionSystemStatus.ARM_STAY_EXIT_DELAY,
      PartitionSystemStatus.ARM_NIGHT_EXIT_DELAY,
    ].includes(partition.systemStatus)) {
      mqttDisarmCommand = 'disarm_from_openlearn_sensor';
    } else if ([
      PartitionSystemStatus.ARM_AWAY,
      PartitionSystemStatus.ARM_STAY,
      PartitionSystemStatus.ARM_NIGHT,
    ].includes(partition.systemStatus)) {
      // Must send ui_delay first when panel is armed
      await this.sendUiDelay(partitionId, partition.systemStatus);
      mqttDisarmCommand = 'disarm_the_panel_from_entry_delay';
    } else {
      mqttDisarmCommand = 'disarm_from_openlearn_sensor';
    }

    const disarmCommand = {
      operation_name: mqttDisarmCommand,
      userID: 1,
      partitionID: parseInt(partitionId, 10),
      operation_source: 1,
      macAddress: this.formattedMac,
    };

    return this.sendIpcPanelCommand([{
      dataType: 'string',
      dataValue: JSON.stringify(disarmCommand),
    }]);
  }

  /** Send ui_delay IPC command (required before disarm from armed state). */
  private async sendUiDelay(
    partitionId: string,
    panelStatus: PartitionSystemStatus,
  ): Promise<Record<string, any> | null> {
    const command = {
      operation_name: 'ui_delay',
      panel_status: panelStatus,
      userID: 0,
      partitionID: partitionId, // STR expected here (matches Python source)
      silentDisarming: false,
      operation_source: 1,
      macAddress: this.formattedMac,
    };

    return this.sendIpcPanelCommand([{
      dataType: 'string',
      dataValue: JSON.stringify(command),
    }]);
  }

  // ---------------------------------------------------------------------------
  // MQTT command infrastructure
  // ---------------------------------------------------------------------------

  /**
   * Send an IPC panel command (arm/disarm/ui_delay).
   * Wraps the command in the MQTTCommand_Panel envelope.
   */
  private async sendIpcPanelCommand(
    ipcRequest: Array<{ dataType: string; dataValue: string }>,
  ): Promise<Record<string, any>> {
    const payload: Record<string, any> = {
      ipcServiceName: 'qinternalservice',
      ipcInterfaceName: 'android.os.IQInternalService',
      ipcTransactionID: 7,
      ipcRequest,
    };

    return this.sendCommand('ipcCall', payload);
  }

  /** Send an MQTT command and wait for the correlated response. */
  private sendCommand(
    eventName: string,
    extra: Record<string, any>,
  ): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
      if (!this.client || this.client.disconnected) {
        reject(new Error('MQTT client not connected'));
        return;
      }

      const requestID = uuidv4();
      const responseTopic = `response_${this.formattedMac}`;

      const payload: Record<string, any> = {
        requestID,
        responseTopic,
        eventName,
        remoteMacAddress: this.formattedMac,
        ...extra,
      };

      // Set up response waiter with timeout
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestID);
        reject(new Error(`Command ${eventName} timed out after ${COMMAND_TIMEOUT_MS}ms`));
      }, COMMAND_TIMEOUT_MS);

      this.pendingRequests.set(requestID, { resolve, reject, timer });

      this.client.publish(TOPIC_PUBLISH, JSON.stringify(payload), { qos: 0 }, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pendingRequests.delete(requestID);
          reject(new Error(`Failed to publish ${eventName}: ${err.message}`));
        }
      });
    });
  }

  /** Handle a response message on the response topic. */
  private handleCommandResponse(data: Record<string, any>): void {
    const requestID = data.requestID;
    if (!requestID) return;

    const pending = this.pendingRequests.get(requestID);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(requestID);
      pending.resolve(data);
    }
  }

  // ---------------------------------------------------------------------------
  // iq2meid message handling
  // ---------------------------------------------------------------------------

  /** Handle an incoming iq2meid database change event. */
  private handleIq2meidMessage(data: Record<string, any>): void {
    this.log('iq2meid message:', JSON.stringify(data));

    if (!this.state) {
      this.log('iq2meid: no state, ignoring');
      return;
    }

    const eventName = data.eventName;

    if (eventName === 'dbChanged') {
      const result = this.dbParser.applyDbChange(data as DbChangedEvent, this.state);
      this.log('dbChanged result:', result ? `${result.type} ${result.type === 'zone' ? result.zoneId : result.partitionId}` : 'null');
      if (!result) return;

      if (result.type === 'zone') {
        const zone = this.state.zones.get(result.zoneId);
        if (zone) {
          this.emit('zone_update', { zoneId: result.zoneId, data: zone });
        }
      } else if (result.type === 'partition') {
        const partition = this.state.partitions.get(result.partitionId);
        if (partition) {
          this.emit('partition_update', { partitionId: result.partitionId, data: partition });

          // Check for alarm state changes
          if (partition.alarmState === PartitionAlarmState.ALARM) {
            this.emit('alarm_event', {
              partitionId: result.partitionId,
              alarmState: partition.alarmState,
              alarmType: partition.alarmTypes.join(', ') || 'Unknown',
            });
          }
        }
      }
    } else if (eventName === 'eventNameDoorBell') {
      this.emit('doorbell', data);
    }
  }

  // ---------------------------------------------------------------------------
  // Ping timer
  // ---------------------------------------------------------------------------

  private async sendPingEvent(): Promise<Record<string, any>> {
    return this.sendCommand('pingevent', {
      remote_panel_status: 'Active',
      macAddress: this.formattedMac,
      ipAddress: this.pluginIp,
      current_battery_status: 'Normal',
      remote_panel_battery_percentage: 100,
      remote_panel_battery_temperature: 430,
      remote_panel_battery_status: 3,
      remote_panel_battery_scale: 100,
      remote_panel_battery_voltage: 4102,
      remote_panel_battery_present: true,
      remote_panel_battery_technology: '',
      remote_panel_battery_level: 100,
      remote_panel_battery_health: 2,
      remote_panel_plugged: 1,
    });
  }

  private startPingTimer(): void {
    this.stopPingTimer();
    this.pingTimer = setInterval(async () => {
      if (this._connected && this.client) {
        try {
          await this.sendPingEvent();
        } catch {
          this.log('Ping failed');
        }
      }
    }, PING_INTERVAL_MS);
  }

  private stopPingTimer(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Reconnection
  // ---------------------------------------------------------------------------

  private handleDisconnect(): void {
    this._connected = false;
    this.stopPingTimer();
    this.rejectAllPending('Connection lost');
    this.emit('disconnected');

    if (this.client) {
      this.client.end(true);
      this.client = null;
    }

    if (!this._destroyed) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    this.stopReconnectTimer();
    this.log(`Reconnecting in ${this.reconnectDelay / 1000}s...`);

    // Exponential backoff happens once per failure, in the catch block
    // below. The previous version doubled here AND in the catch, which
    // grew the delay 4× per failure instead of 2×.
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch (err) {
        this.log('Reconnect failed:', err);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
        if (!this._destroyed) {
          this.scheduleReconnect();
        }
      }
    }, this.reconnectDelay);
  }

  private stopReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }

  // ---------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------

  private log(...args: any[]): void {
    this.homey.log('[QolsysPanelClient]', ...args);
  }

}
