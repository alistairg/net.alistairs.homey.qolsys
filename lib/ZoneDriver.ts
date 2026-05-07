import Homey from 'homey';
import { getCapabilitiesForZone, getDeviceClassForZone, shouldIncludeZone } from './ZoneTypes';
import { getBatteryType } from './BatteryTypes';

import type QolsysApp from '../app';

/**
 * Shared driver implementation for every per-type zone driver
 * (contact-sensor, motion-sensor, smoke-detector, co-detector,
 * water-sensor, generic-sensor).
 *
 * Each subclass implements claimsZoneType to indicate which Qolsys
 * sensor types it handles. The pairing flow filters the panel's full
 * zone list down to only those types so the user only sees zones
 * relevant to the driver they picked.
 */
export abstract class ZoneDriver extends Homey.Driver {

  /**
   * Returns true if this driver should expose the given sensor type
   * as a Homey device. Specific drivers (contact-sensor, motion-sensor,
   * etc.) return true for an explicit allow-list; generic-sensor
   * returns true for "everything no specific driver claimed."
   */
  protected abstract claimsZoneType(sensorType: string): boolean;

  private _zoneTamperedCard!: Homey.FlowCardTriggerDevice;

  /**
   * The trigger card id is derived from the driver id (e.g.
   * `contact-sensor_tampered`) so each driver has a globally-unique
   * flow card. Athom requires every flow card id to be unique across
   * the entire app — a shared `zone_tampered` across all six drivers
   * would fail validation.
   */
  protected get tamperedFlowCardId(): string {
    return `${this.id}_tampered`;
  }

  async onInit(): Promise<void> {
    this.log(`${this.id} driver initialised`);
    this._zoneTamperedCard = this.homey.flow.getDeviceTriggerCard(this.tamperedFlowCardId);
  }

  triggerTampered(device: Homey.Device): void {
    this._zoneTamperedCard.trigger(device).catch(this.error);
  }

  async onPair(session: Homey.Driver.PairSession): Promise<void> {
    session.setHandler('list_devices', async () => {
      const app = this.homey.app as QolsysApp;
      const client = app.getClient();

      if (!client?.isConnected || !client.databaseState) {
        this.log('No connected panel — cannot list zones');
        return [];
      }

      const state = client.databaseState;
      const devices: any[] = [];

      for (const [zoneId, zone] of state.zones) {
        // Excluded protocol-level types (keypad, bluetooth, takeover module)
        if (!shouldIncludeZone(zone.sensorType)) continue;

        // Per-driver type filter — each driver only lists zones whose
        // sensor type it specifically handles.
        if (!this.claimsZoneType(zone.sensorType)) continue;

        // We can't tell from the static database whether a PowerG zone
        // reports temperature or light specifically, so we add both
        // capabilities optimistically; the device only writes values
        // when the panel actually sends them.
        const isPowerG = zone.currentCapability === 'POWERG';
        const capabilities = getCapabilitiesForZone(zone.sensorType, isPowerG, isPowerG);
        const deviceClass = getDeviceClassForZone(zone.sensorType);

        devices.push({
          name: zone.sensorName || `Zone ${zoneId}`,
          data: {
            id: `zone_${zoneId}`,
            zoneId,
          },
          class: deviceClass,
          capabilities,
          settings: {
            sensor_zone_id: zoneId,
            sensor_type: zone.sensorType,
            battery_type: getBatteryType(zone.sensorType) || 'Unknown',
          },
        });
      }

      return devices;
    });
  }

}

