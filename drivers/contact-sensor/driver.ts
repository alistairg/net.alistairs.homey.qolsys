import { ZoneDriver } from '../../lib/ZoneDriver';
import { ContactSensorTypes } from '../../lib/ZoneTypes';

export default class ContactSensorDriver extends ZoneDriver {

  protected claimsZoneType(sensorType: string): boolean {
    return ContactSensorTypes.includes(sensorType);
  }

}

module.exports = ContactSensorDriver;
