import { ZoneDriver } from '../../lib/ZoneDriver';
import { CODetectorTypes } from '../../lib/ZoneTypes';

export default class CODetectorDriver extends ZoneDriver {

  protected claimsZoneType(sensorType: string): boolean {
    return CODetectorTypes.includes(sensorType);
  }

}

module.exports = CODetectorDriver;
