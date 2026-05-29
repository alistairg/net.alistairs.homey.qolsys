import Homey from 'homey';
import {
  PartitionSystemStatus,
  PartitionAlarmState,
  PartitionArmingType,
  QolsysPartitionData,
  QolsysZoneData,
} from '../../lib/types';
import { isZoneActive } from '../../lib/ZoneTypes';
import { stripPort } from '../../lib/NetUtil';

import type QolsysApp from '../../app';
import type AlarmPanelDriver from './driver';
import type { QolsysPanelClient } from '../../lib/QolsysPanelClient';

const SCHEMA_VERSION = 2;
const DISCONNECT_GRACE_MS = 3000;

export default class AlarmPanelDevice extends Homey.Device {

  private client: QolsysPanelClient | null = null;
  private partitionId: string = '';
  private disconnectFlapTimer: NodeJS.Timeout | null = null;
  private lastAlarmState: PartitionAlarmState | null = null;
  private lastSystemStatus: PartitionSystemStatus | null = null;
  private lastArmMode: string | null = null;

  // Bound listeners for cleanup
  private _onConnected = () => this.handleConnected();
  private _onDisconnected = () => this.handleDisconnected();
  private _onPartitionUpdate = (e: any) => this.handlePartitionUpdate(e);
  private _onAlarmEvent = (e: any) => this.handleAlarmEvent(e);
  private _onZoneUpdate = () => this.updateReadyToArm();

  async onInit(): Promise<void> {
    await super.onInit();
    this.log('Alarm Panel device initializing:', this.getName());

    this.partitionId = this.getData().partitionId;

    await this.migrateCapabilities();

    // Seed the panel-confirmed arm mode from the persisted capability value.
    // The arm_mode_changed trigger compares against THIS, not the live
    // capability value: when a user arms from the Homey UI, Homey sets the
    // capability optimistically before the panel confirms, so the capability
    // already equals the target by the time SYSTEM_STATUS lands — comparing
    // against it would silently swallow the change. Seeding from the stored
    // value here keeps the no-op on boot (persisted == panel state).
    this.lastArmMode = (this.getCapabilityValue('arm_mode') as string | null) ?? null;

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

    // Bind to the shared MQTT client. Awaiting this means we don't return
    // from onInit until listeners are attached, eliminating the window
    // where panel events could fire before we're listening.
    await this.bindClient();
  }

  async onUninit(): Promise<void> {
    await super.onUninit();
    this.log('Alarm Panel device uninitializing:', this.getName());
    if (this.disconnectFlapTimer) {
      this.homey.clearTimeout(this.disconnectFlapTimer);
      this.disconnectFlapTimer = null;
    }
    this.unbindClient();
  }

  async onDeleted(): Promise<void> {
    await super.onDeleted();
    await this.onUninit();
  }

  /**
   * Add capabilities that may be missing on devices paired before they
   * existed. Schema-versioned so we don't redundantly probe every boot —
   * once a device is at the current schema, no per-capability hasCapability
   * calls run.
   */
  private async migrateCapabilities(): Promise<void> {
    const stored = (this.getStoreValue('schema_version') as number | undefined) ?? 0;
    if (stored >= SCHEMA_VERSION) return;

    const requiredCaps = ['alarm_sounding', 'alarm_tamper', 'arm_mode', 'alarm_arming', 'alarm_entry_delay', 'ready_to_arm'];
    for (const cap of requiredCaps) {
      if (!this.hasCapability(cap)) {
        await this.addCapability(cap).catch((err) => this.log(`Failed to add ${cap}:`, err));
      }
    }
    // alarm_generic was renamed to alarm_sounding so the auto-generated
    // flow cards inherit a sensible title from the custom capability
    // instead of the system "Generic alarm".
    if (this.hasCapability('alarm_generic')) {
      await this.removeCapability('alarm_generic').catch((err) => this.log('Failed to remove alarm_generic:', err));
    }
    await this.setStoreValue('schema_version', SCHEMA_VERSION);
  }

  // ---------------------------------------------------------------------------
  // Client binding
  // ---------------------------------------------------------------------------

  /**
   * Acquire (or create) the shared MQTT client and attach our listeners.
   * Async — listener attachment must complete before onInit returns,
   * otherwise an arriving panel event could be silently dropped.
   */
  private async bindClient(): Promise<void> {
    const app = this.homey.app as QolsysApp;
    this.client = app.getClient();

    if (!this.client) {
      // First device for this panel — create the singleton.
      const panelIp = (this.getStoreValue('panelIp') as string | undefined)
        || (this.getSetting('panel_ip') as string | undefined);
      if (!panelIp) {
        this.log('No panel IP stored — cannot connect');
        return;
      }

      let pluginIp: string;
      try {
        const localAddress = await this.homey.cloud.getLocalAddress();
        pluginIp = stripPort(localAddress);
      } catch (err) {
        this.log('Failed to get local address:', err);
        return;
      }

      this.client = app.createClient(panelIp, pluginIp);
    }

    // Attach listeners synchronously now that we have the client.
    this.client.on('connected', this._onConnected);
    this.client.on('disconnected', this._onDisconnected);
    this.client.on('partition_update', this._onPartitionUpdate);
    this.client.on('alarm_event', this._onAlarmEvent);
    this.client.on('zone_update', this._onZoneUpdate);

    // Kick off connect if not already in progress (createClient on a fresh
    // singleton constructs but doesn't auto-connect).
    if (!this.client.isConnected) {
      this.client.connect().catch((err) => this.log('Failed to connect:', err));
    } else {
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
    // Cancel any pending disconnect-grace timer — we're back.
    if (this.disconnectFlapTimer) {
      this.homey.clearTimeout(this.disconnectFlapTimer);
      this.disconnectFlapTimer = null;
    }
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

  /**
   * Defer setUnavailable by a short grace window — the panel disconnects
   * briefly during pairing handshakes and reconnect cycles, and flickering
   * the device tile red on each blip is bad UX. If a connect arrives
   * within the window, we cancel and stay green.
   */
  private handleDisconnected(): void {
    if (this.disconnectFlapTimer) return;
    this.disconnectFlapTimer = this.homey.setTimeout(() => {
      this.disconnectFlapTimer = null;
      this.setUnavailable('Disconnected from panel').catch(this.error);
    }, DISCONNECT_GRACE_MS);
  }

  private handlePartitionUpdate(event: { partitionId: string; data: QolsysPartitionData }): void {
    if (event.partitionId !== this.partitionId) return;
    this.syncPartitionState(event.data);
  }

  /**
   * Fire the alarm trigger only on the disarmed/idle → ALARM transition.
   * The panel emits partition_update repeatedly while alarming (every
   * dbChanged); previously we triggered the flow card on each, spamming
   * any user notifications. Track the previous state and gate.
   */
  private handleAlarmEvent(event: { partitionId: string; alarmState: string; alarmType: string }): void {
    if (event.partitionId !== this.partitionId) return;

    const newState = event.alarmState as PartitionAlarmState;
    const previousState = this.lastAlarmState;
    this.lastAlarmState = newState;

    // Only fire on the rising edge into ALARM. Continuing-alarm updates
    // and exit-from-alarm are not user-facing trigger-worthy events.
    if (newState !== PartitionAlarmState.ALARM) return;
    if (previousState === PartitionAlarmState.ALARM) return;

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

    // Entry delay = alarm countdown on an already fully-armed partition (a
    // door opened while armed). It requires an ARM-* status, NOT ARM-*-EXIT-DELAY
    // (that's arming) and NOT a stale DISARM that hasn't caught up mid-arm —
    // either of those would otherwise be misread as an entry delay.
    const isArmed = [
      PartitionSystemStatus.ARM_AWAY,
      PartitionSystemStatus.ARM_STAY,
      PartitionSystemStatus.ARM_NIGHT,
    ].includes(partition.systemStatus);
    const isEntryDelay = partition.alarmState === PartitionAlarmState.DELAY && isArmed;
    this.setCapabilityValue('alarm_entry_delay', isEntryDelay).catch(this.error);

    // Alarm sounding
    const isAlarming = partition.alarmState === PartitionAlarmState.ALARM;
    this.setCapabilityValue('alarm_sounding', isAlarming).catch(this.error);

    // homealarm_state + arm_mode derive SOLELY from SYSTEM_STATUS, so only
    // recompute them when SYSTEM_STATUS actually changed. The panel emits
    // separate dbChanged events for ALARM_STATE / EXIT_SOUNDS / ENTRY_DELAYS,
    // and each fires a partition_update — but those arrive while the panel
    // still reports the *previous* SYSTEM_STATUS. Re-deriving the arm state
    // from that stale value flaps the tile mid-arm (e.g. night → disarmed →
    // night) before the real SYSTEM_STATUS update lands. An UNKNOWN status
    // (unparseable value) is held rather than dropped to disarmed.
    if (partition.systemStatus === PartitionSystemStatus.UNKNOWN) return;
    if (partition.systemStatus === this.lastSystemStatus) return;
    this.lastSystemStatus = partition.systemStatus;

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
    }
    this.setCapabilityValue('homealarm_state', homealarmState).catch(this.error);

    // Fire on the panel-confirmed transition, tracked independently of the
    // (optimistically-set) capability value — see lastArmMode seeding in onInit.
    const previousArmMode = this.lastArmMode;
    this.lastArmMode = armMode;
    this.setCapabilityValue('arm_mode', armMode).catch(this.error);
    if (previousArmMode !== armMode) {
      (this.driver as AlarmPanelDriver).triggerArmModeChanged(this, armMode);
    }
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
