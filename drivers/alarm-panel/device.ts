import Homey from 'homey';
import {
  PartitionSystemStatus,
  PartitionAlarmState,
  PartitionArmingType,
  QolsysPartitionData,
  QolsysZoneData,
} from '../../lib/types';
import { isZoneActive } from '../../lib/ZoneTypes';

import type QolsysApp from '../../app';
import type AlarmPanelDriver from './driver';
import type { QolsysPanelClient } from '../../lib/QolsysPanelClient';

export default class AlarmPanelDevice extends Homey.Device {

  private client: QolsysPanelClient | null = null;
  private partitionId: string = '';

  // Bound listeners for cleanup
  private _onConnected = () => this.handleConnected();
  private _onDisconnected = () => this.handleDisconnected();
  private _onPartitionUpdate = (e: any) => this.handlePartitionUpdate(e);
  private _onAlarmEvent = (e: any) => this.handleAlarmEvent(e);
  private _onZoneUpdate = () => this.updateReadyToArm();

  async onInit(): Promise<void> {
    this.log('Alarm Panel device initializing:', this.getName());

    this.partitionId = this.getData().partitionId;

    // Migrate capabilities added after initial pairing
    const requiredCaps = ['alarm_generic', 'alarm_tamper', 'arm_mode', 'alarm_arming', 'alarm_entry_delay', 'ready_to_arm'];
    for (const cap of requiredCaps) {
      if (!this.hasCapability(cap)) {
        await this.addCapability(cap).catch((err) => this.log(`Failed to add ${cap}:`, err));
      }
    }

    // Register capability listener for arm/disarm from Homey UI
    this.registerCapabilityListener('homealarm_state', async (value: string) => {
      switch (value) {
        case 'armed':
          await this.armAway();
          break;
        case 'partially_armed':
          await this.armHome();
          break;
        case 'disarmed':
          await this.disarm();
          break;
      }
    });

    this.registerCapabilityListener('arm_mode', async (value: string) => {
      switch (value) {
        case 'arm_away':
          await this.armAway();
          break;
        case 'arm_stay':
          await this.armHome();
          break;
        case 'arm_night':
          await this.armNight();
          break;
        case 'disarmed':
          await this.disarm();
          break;
      }
    });

    // Bind to the shared MQTT client
    this.bindClient();
  }

  async onUninit(): Promise<void> {
    this.log('Alarm Panel device uninitializing:', this.getName());
    this.unbindClient();
  }

  // ---------------------------------------------------------------------------
  // Client binding
  // ---------------------------------------------------------------------------

  private bindClient(): void {
    const app = this.homey.app as QolsysApp;
    this.client = app.getClient();

    if (!this.client) {
      // Create and connect client on boot
      const panelIp = this.getStoreValue('panelIp') || this.getSetting('panel_ip');
      if (!panelIp) {
        this.log('No panel IP stored — cannot connect');
        return;
      }

      // Get fresh local IP (may change between boots with DHCP)
      this.homey.cloud.getLocalAddress().then((localAddress) => {
        const pluginIp = localAddress.replace(/:.*$/, '');
        this.client = app.createClient(panelIp, pluginIp);
        this.client.on('connected', this._onConnected);
        this.client.on('disconnected', this._onDisconnected);
        this.client.on('partition_update', this._onPartitionUpdate);
        this.client.on('alarm_event', this._onAlarmEvent);
        this.client.on('zone_update', this._onZoneUpdate);
        this.client.connect().catch((err) => {
          this.log('Failed to connect:', err);
        });
      }).catch((err) => {
        this.log('Failed to get local address:', err);
      });
      return;
    }

    this.client.on('connected', this._onConnected);
    this.client.on('disconnected', this._onDisconnected);
    this.client.on('partition_update', this._onPartitionUpdate);
    this.client.on('alarm_event', this._onAlarmEvent);
    this.client.on('zone_update', this._onZoneUpdate);

    // If already connected, sync state immediately
    if (this.client.isConnected) {
      this.handleConnected();
    }
  }

  private unbindClient(): void {
    if (this.client) {
      this.client.removeListener('connected', this._onConnected);
      this.client.removeListener('disconnected', this._onDisconnected);
      this.client.removeListener('partition_update', this._onPartitionUpdate);
      this.client.removeListener('alarm_event', this._onAlarmEvent);
      this.client.removeListener('zone_update', this._onZoneUpdate);
      this.client = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  private handleConnected(): void {
    this.setAvailable().catch(this.error);

    // Sync current partition state
    const state = this.client?.databaseState;
    const partition = state?.partitions.get(this.partitionId);
    if (partition) {
      this.syncPartitionState(partition);
    }
    this.updateReadyToArm();
    this.updatePanelTamper();
  }

  private handleDisconnected(): void {
    this.setUnavailable('Disconnected from panel').catch(this.error);
  }

  private handlePartitionUpdate(event: { partitionId: string; data: QolsysPartitionData }): void {
    if (event.partitionId !== this.partitionId) return;
    this.syncPartitionState(event.data);
  }

  private handleAlarmEvent(event: { partitionId: string; alarmState: string; alarmType: string }): void {
    if (event.partitionId !== this.partitionId) return;

    const driver = this.driver as AlarmPanelDriver;
    driver.triggerAlarm(this, {
      partition_name: this.getName(),
      alarm_type: event.alarmType,
    });
  }

  // ---------------------------------------------------------------------------
  // State sync
  // ---------------------------------------------------------------------------

  private syncPartitionState(partition: QolsysPartitionData): void {
    const isExitDelay = [
      PartitionSystemStatus.ARM_AWAY_EXIT_DELAY,
      PartitionSystemStatus.ARM_STAY_EXIT_DELAY,
      PartitionSystemStatus.ARM_NIGHT_EXIT_DELAY,
    ].includes(partition.systemStatus);

    // Exit delay → arming in progress
    this.setCapabilityValue('alarm_arming', isExitDelay).catch(this.error);

    // Entry delay (alarm state is Delay, but NOT during exit delay — that's arming)
    const isEntryDelay = partition.alarmState === PartitionAlarmState.DELAY && !isExitDelay;
    this.setCapabilityValue('alarm_entry_delay', isEntryDelay).catch(this.error);

    // Alarm sounding
    const isAlarming = partition.alarmState === PartitionAlarmState.ALARM;
    this.setCapabilityValue('alarm_generic', isAlarming).catch(this.error);

    // Map partition system status to Homey alarm state + arm mode
    let homealarmState: string;
    let armMode: string;

    switch (partition.systemStatus) {
      case PartitionSystemStatus.ARM_AWAY:
      case PartitionSystemStatus.ARM_AWAY_EXIT_DELAY:
        homealarmState = 'armed';
        armMode = 'arm_away';
        break;
      case PartitionSystemStatus.ARM_STAY:
      case PartitionSystemStatus.ARM_STAY_EXIT_DELAY:
        homealarmState = 'partially_armed';
        armMode = 'arm_stay';
        break;
      case PartitionSystemStatus.ARM_NIGHT:
      case PartitionSystemStatus.ARM_NIGHT_EXIT_DELAY:
        homealarmState = 'partially_armed';
        armMode = 'arm_night';
        break;
      case PartitionSystemStatus.DISARM:
        homealarmState = 'disarmed';
        armMode = 'disarmed';
        break;
      default:
        homealarmState = 'disarmed';
        armMode = 'disarmed';
    }

    const current = this.getCapabilityValue('homealarm_state');
    if (current !== homealarmState) {
      this.log(`Alarm state: ${current} → ${homealarmState} (panel: ${partition.systemStatus})`);
      this.homey.notifications.createNotification({
        excerpt: `Alarm ${homealarmState === 'armed' ? 'armed away' : homealarmState === 'partially_armed' ? 'armed home' : 'disarmed'}`,
      }).catch(() => {});
    }
    this.setCapabilityValue('homealarm_state', homealarmState).catch(this.error);
    this.setCapabilityValue('arm_mode', armMode).catch(this.error);
  }

  /** Check if all zones in this partition are secure (closed/idle/normal). */
  private updateReadyToArm(): void {
    const state = this.client?.databaseState;
    if (!state) return;

    let ready = true;
    for (const [, zone] of state.zones) {
      if (zone.partitionId !== this.partitionId) continue;
      if (isZoneActive(zone.sensorStatus)) {
        ready = false;
        break;
      }
    }
    this.setCapabilityValue('ready_to_arm', ready).catch(this.error);
  }

  /** Update panel tamper from global panel info. */
  private updatePanelTamper(): void {
    const state = this.client?.databaseState;
    if (!state) return;
    const tampered = state.panelInfo.tamperState !== '' && state.panelInfo.tamperState !== 'Normal';
    this.setCapabilityValue('alarm_tamper', tampered).catch(this.error);
  }

  // ---------------------------------------------------------------------------
  // Arm / Disarm actions
  // ---------------------------------------------------------------------------

  async armAway(): Promise<void> {
    if (!this.client?.isConnected) throw new Error('Not connected to panel');
    await this.client.armPartition(this.partitionId, PartitionArmingType.ARM_AWAY);
  }

  async armHome(): Promise<void> {
    if (!this.client?.isConnected) throw new Error('Not connected to panel');
    await this.client.armPartition(this.partitionId, PartitionArmingType.ARM_STAY);
  }

  async armNight(): Promise<void> {
    if (!this.client?.isConnected) throw new Error('Not connected to panel');
    await this.client.armPartition(this.partitionId, PartitionArmingType.ARM_NIGHT);
  }

  async disarm(): Promise<void> {
    if (!this.client?.isConnected) throw new Error('Not connected to panel');
    await this.client.disarmPartition(this.partitionId);
  }

}

module.exports = AlarmPanelDevice;
