import { ZoneDriver } from '../../lib/ZoneDriver';
import { SmokeDetectorTypes } from '../../lib/ZoneTypes';

export default class SmokeDetectorDriver extends ZoneDriver {

  protected claimsZoneType(sensorType: string): boolean {
    return SmokeDetectorTypes.includes(sensorType);
  }

}

module.exports = SmokeDetectorDriver;
