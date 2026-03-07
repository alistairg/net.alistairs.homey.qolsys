import Homey from 'homey';
import { getCapabilitiesForZone, getDeviceClassForZone, shouldIncludeZone } from '../../lib/ZoneTypes';
import { getBatteryType } from '../../lib/BatteryTypes';

import type QolsysApp from '../../app';

export default class ZoneSensorDriver extends Homey.Driver {

  private _zoneTamperedCard!: Homey.FlowCardTriggerDevice;

  async onInit(): Promise<void> {
    this.log('Zone Sensor driver initialized');
    this._zoneTamperedCard = this.homey.flow.getDeviceTriggerCard('zone_tampered');
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

      // Determine which PowerG shortIDs have temperature/light from the initial sync
      // (PowerG devices with supported_type 161 report temp+light, 109/150 may report temp or light)
      // We check currentCapability === 'POWERG' as a baseline; actual data arrives via PowerG events.
      // For pairing, we optimistically add these capabilities for all PowerG sensors.
      for (const [zoneId, zone] of state.zones) {
        this.log(`Zone ${zoneId}: type=${zone.sensorType} name=${zone.sensorName}`);
        // Skip non-sensor types (keypad, bluetooth)
        if (!shouldIncludeZone(zone.sensorType)) continue;

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

module.exports = ZoneSensorDriver;
