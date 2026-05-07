import { ZoneDriver } from '../../lib/ZoneDriver';
import { WaterSensorTypes } from '../../lib/ZoneTypes';

export default class WaterSensorDriver extends ZoneDriver {

  protected claimsZoneType(sensorType: string): boolean {
    return WaterSensorTypes.includes(sensorType);
  }

}

module.exports = WaterSensorDriver;
