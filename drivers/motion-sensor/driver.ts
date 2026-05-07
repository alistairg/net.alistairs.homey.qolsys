import { ZoneDriver } from '../../lib/ZoneDriver';
import { MotionSensorTypes } from '../../lib/ZoneTypes';

export default class MotionSensorDriver extends ZoneDriver {

  protected claimsZoneType(sensorType: string): boolean {
    return MotionSensorTypes.includes(sensorType);
  }

}

module.exports = MotionSensorDriver;
