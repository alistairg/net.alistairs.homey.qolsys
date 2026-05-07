import Homey from 'homey';
import { QolsysZoneData, ZoneStatus } from './types';
import { isZoneActive, MotionSensorTypes } from './ZoneTypes';
import { stripPort } from './NetUtil';

import type QolsysApp from '../app';
import type { QolsysPanelClient } from './QolsysPanelClient';

/**
 * Shared device implementation for every zone-type driver
 * (contact-sensor, motion-sensor, smoke-detector, co-detector,
 * water-sensor, generic-sensor). The per-driver subclass adds nothing —
 * the only thing that varies between zone types is the set of
 * capabilities declared in the driver's compose.json (e.g. alarm_contact
 * vs alarm_motion). At runtime we look up the device's own capabilities
 * and update them dynamically, so this class is identical regardless of
 * which sensor type it's bound to.
 */
export default class ZoneDevice extends Homey.Device {

  private client: QolsysPanelClient | null = null;
  private zoneId: string = '';

  // Bound listener references kept on the instance so we can
  // removeListener with the same reference on uninit.
  private _onConnected = () => this.handleConnected();
  private _onDisconnected = () => this.handleDisconnected();
  private _onZoneUpdate = (e: any) => this.handleZoneUpdate(e);

  async onInit(): Promise<void> {
    await super.onInit();
    this.log('Zone device initialising:', this.getName());

    this.zoneId = this.getData().zoneId;

    await this.migrateRemoveStaleCapabilities();
    await this.bindClient();
  }

  /**
   * TEMPORARY one-shot migration. Devices paired before the
   * fix-powerg-extras-scope branch landed received `measure_temperature`
   * and `measure_luminance` regardless of sensor type. Only motion-class
   * hardware actually reports those values; on non-motion zones they
   * sat at 0 forever. Remove them on first init after the upgrade.
   *
   * Idempotent: once removed, hasCapability returns false and the
   * branches are no-ops.
   *
   * TODO: drop this method once Alistair's dev install has been
   * migrated through it once. Net-new pairs after the scope fix will
   * never have these caps in the first place.
   */
  private async migrateRemoveStaleCapabilities(): Promise<void> {
    const sensorType = (this.getSetting('sensor_type') as string) ?? '';
    const isMotionClass = MotionSensorTypes.includes(sensorType);
    if (isMotionClass) return;

    if (this.hasCapability('measure_temperature')) {
      await this.removeCapability('measure_temperature')
        .then(() => this.log('Removed stale measure_temperature'))
        .catch((err) => this.log('Failed to remove measure_temperature:', err));
    }
    if (this.hasCapability('measure_luminance')) {
      await this.removeCapability('measure_luminance')
        .then(() => this.log('Removed stale measure_luminance'))
        .catch((err) => this.log('Failed to remove measure_luminance:', err));
    }
  }

  async onUninit(): Promise<void> {
    await super.onUninit();
    this.log('Zone device uninitializing:', this.getName());
    this.unbindClient();
  }

  async onDeleted(): Promise<void> {
    await super.onDeleted();
    await this.onUninit();
  }

  /**
   * Acquire (or create) the shared panel client. If alarm-panel hasn't
   * initialised yet (e.g. zones boot first on a multi-device app start)
   * we create the singleton ourselves rather than giving up — otherwise
   * the device would stay permanently disconnected until the user
   * removed and re-added it.
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

  private handleConnected(): void {
    this.setAvailable().catch(this.error);

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

  private syncZoneState(zone: QolsysZoneData): void {
    const active = isZoneActive(zone.sensorStatus);

    // Update whichever primary alarm capability this device was paired
    // with (alarm_contact / alarm_motion / alarm_smoke / alarm_co /
    // alarm_water / alarm_generic). The compose for each driver declares
    // exactly one of these; we find it dynamically rather than baking
    // the type into this class.
    const primaryCap = this.getCapabilities().find((c) =>
      c.startsWith('alarm_') && c !== 'alarm_tamper' && c !== 'alarm_battery',
    );
    if (primaryCap) {
      this.setCapabilityValue(primaryCap, active).catch(this.error);
    }

    // Tamper (zone-level)
    if (this.hasCapability('alarm_tamper')) {
      const tampered = zone.sensorStatus === ZoneStatus.TAMPERED;
      this.setCapabilityValue('alarm_tamper', tampered).catch(this.error);

      if (tampered) {
        const driver = this.driver as { triggerTampered?: (d: Homey.Device) => void };
        driver.triggerTampered?.(this);
      }
    }

    // Battery — "Normal" or empty = ok, anything else = low
    if (this.hasCapability('alarm_battery')) {
      const batteryLow = zone.batteryStatus !== '' && zone.batteryStatus !== 'Normal';
      this.setCapabilityValue('alarm_battery', batteryLow).catch(this.error);
    }

    // PowerG temperature — panel reports °F, Homey wants °C
    if (this.hasCapability('measure_temperature') && zone.powergTemperature !== undefined) {
      const tempC = Math.round(((zone.powergTemperature - 32) * 5 / 9) * 10) / 10;
      this.setCapabilityValue('measure_temperature', tempC).catch(this.error);
    }

    // PowerG light level (raw lux-ish value reported by the panel)
    if (this.hasCapability('measure_luminance') && zone.powergLight !== undefined) {
      this.setCapabilityValue('measure_luminance', zone.powergLight).catch(this.error);
    }
  }

}

