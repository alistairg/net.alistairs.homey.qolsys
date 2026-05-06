import Homey from 'homey';
import { QolsysZoneData, ZoneStatus } from '../../lib/types';
import { isZoneActive } from '../../lib/ZoneTypes';
import { stripPort } from '../../lib/NetUtil';

import type QolsysApp from '../../app';
import type ZoneSensorDriver from './driver';
import type { QolsysPanelClient } from '../../lib/QolsysPanelClient';

export default class ZoneSensorDevice extends Homey.Device {

  private client: QolsysPanelClient | null = null;
  private zoneId: string = '';

  // Bound listeners for cleanup
  private _onConnected = () => this.handleConnected();
  private _onDisconnected = () => this.handleDisconnected();
  private _onZoneUpdate = (e: any) => this.handleZoneUpdate(e);

  async onInit(): Promise<void> {
    await super.onInit();
    this.log('Zone Sensor device initializing:', this.getName());

    this.zoneId = this.getData().zoneId;
    await this.bindClient();
  }

  async onUninit(): Promise<void> {
    await super.onUninit();
    this.log('Zone Sensor device uninitializing:', this.getName());
    this.unbindClient();
  }

  async onDeleted(): Promise<void> {
    await super.onDeleted();
    await this.onUninit();
  }

  // ---------------------------------------------------------------------------
  // Client binding
  // ---------------------------------------------------------------------------

  /**
   * Acquire (or create) the shared panel client. Previously this gave
   * up silently if alarm-panel hadn't initialised yet — leaving zones
   * permanently disconnected until the user removed and re-added them.
   * Now zones are first-class clients of the singleton; if alarm-panel
   * hasn't run yet, we create the client ourselves using the panel IP
   * stored at app-level settings.
   */
  private async bindClient(): Promise<void> {
    const app = this.homey.app as QolsysApp;
    this.client = app.getClient();

    if (!this.client) {
      const panelIp = this.homey.settings.get('panel_ip') as string | undefined;
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

    this.client.on('connected', this._onConnected);
    this.client.on('disconnected', this._onDisconnected);
    this.client.on('zone_update', this._onZoneUpdate);

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
      this.client.removeListener('zone_update', this._onZoneUpdate);
      this.client = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  private handleConnected(): void {
    this.setAvailable().catch(this.error);

    // Sync current zone state
    const state = this.client?.databaseState;
    const zone = state?.zones.get(this.zoneId);
    if (zone) {
      this.syncZoneState(zone);
    }
  }

  private handleDisconnected(): void {
    this.setUnavailable('Disconnected from panel').catch(this.error);
  }

  private handleZoneUpdate(event: { zoneId: string; data: QolsysZoneData }): void {
    if (event.zoneId !== this.zoneId) return;
    this.syncZoneState(event.data);
  }

  // ---------------------------------------------------------------------------
  // State sync
  // ---------------------------------------------------------------------------

  private syncZoneState(zone: QolsysZoneData): void {
    const active = isZoneActive(zone.sensorStatus);

    // Update the primary capability (alarm_contact, alarm_motion, etc.)
    const primaryCap = this.getCapabilities().find((c) =>
      c.startsWith('alarm_') && c !== 'alarm_tamper' && c !== 'alarm_battery',
    );
    if (primaryCap) {
      this.setCapabilityValue(primaryCap, active).catch(this.error);
    }

    // Tamper
    if (this.hasCapability('alarm_tamper')) {
      const tampered = zone.sensorStatus === ZoneStatus.TAMPERED;
      this.setCapabilityValue('alarm_tamper', tampered).catch(this.error);

      if (tampered) {
        const driver = this.driver as ZoneSensorDriver;
        driver.triggerTampered(this);
      }
    }

    // Battery
    if (this.hasCapability('alarm_battery')) {
      // battery_status of "Normal" or empty = ok, anything else = low
      const batteryLow = zone.batteryStatus !== '' && zone.batteryStatus !== 'Normal';
      this.setCapabilityValue('alarm_battery', batteryLow).catch(this.error);
    }

    // PowerG temperature (reported in °F, convert to °C for Homey)
    if (this.hasCapability('measure_temperature') && zone.powergTemperature !== undefined) {
      const tempC = Math.round(((zone.powergTemperature - 32) * 5 / 9) * 10) / 10;
      this.setCapabilityValue('measure_temperature', tempC).catch(this.error);
    }

    // PowerG light level (raw lux-ish value from panel)
    if (this.hasCapability('measure_luminance') && zone.powergLight !== undefined) {
      this.setCapabilityValue('measure_luminance', zone.powergLight).catch(this.error);
    }
  }

}

module.exports = ZoneSensorDevice;
