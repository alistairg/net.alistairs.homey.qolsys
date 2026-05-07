import { ZoneDriver } from '../../lib/ZoneDriver';
import { GlassBreakDetectorTypes } from '../../lib/ZoneTypes';

export default class GlassBreakDetectorDriver extends ZoneDriver {

  protected claimsZoneType(sensorType: string): boolean {
    return GlassBreakDetectorTypes.includes(sensorType);
  }

}

module.exports = GlassBreakDetectorDriver;
