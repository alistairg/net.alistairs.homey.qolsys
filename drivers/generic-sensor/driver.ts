import { ZoneDriver } from '../../lib/ZoneDriver';
import { isGenericSensorType } from '../../lib/ZoneTypes';

/**
 * Catch-all driver for sensor types that don't fit a specific category.
 * Examples: glass break, freeze, shock, doorbell, key fob, siren,
 * temperature, etc. Each device gets `alarm_generic` as its primary
 * capability (plus tamper + battery).
 *
 * If you find yourself routinely adding a new specific type to this
 * driver, consider promoting it to its own driver instead.
 */
export default class GenericSensorDriver extends ZoneDriver {

  protected claimsZoneType(sensorType: string): boolean {
    return isGenericSensorType(sensorType);
  }

}

module.exports = GenericSensorDriver;
