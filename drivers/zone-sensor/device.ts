import Homey from 'homey';
import { QolsysZoneData, ZoneStatus } from '../../lib/types';
import { isZoneActive } from '../../lib/ZoneTypes';

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
    this.log('Zone Sensor device initializing:', this.getName());

    this.zoneId = this.getData().zoneId;
    this.bindClient();
  }

  async onUninit(): Promise<void> {
    this.log('Zone Sensor device uninitializing:', this.getName());
    this.unbindClient();
  }

  // ---------------------------------------------------------------------------
  // Client binding
  // ---------------------------------------------------------------------------

  private bindClient(): void {
    const app = this.homey.app as QolsysApp;
    this.client = app.getClient();

    if (!this.client) {
      this.log('No panel client available');
      return;
    }

    this.client.on('connected', this._onConnected);
    this.client.on('disconnected', this._onDisconnected);
    this.client.on('zone_update', this._onZoneUpdate);

    if (this.client.isConnected) {
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
