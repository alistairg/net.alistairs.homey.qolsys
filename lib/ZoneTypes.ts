import { ZoneSensorType, ZoneStatus } from './types';

interface ZoneCapabilityMapping {
  primaryCapability: string;
  deviceClass: string;
}

const ZONE_TYPE_MAP: Record<string, ZoneCapabilityMapping> = {
  [ZoneSensorType.DOOR_WINDOW]:       { primaryCapability: 'alarm_contact', deviceClass: 'sensor' },
  [ZoneSensorType.DOOR_WINDOW_M]:     { primaryCapability: 'alarm_contact', deviceClass: 'sensor' },
  [ZoneSensorType.TILT]:              { primaryCapability: 'alarm_contact', deviceClass: 'sensor' },
  [ZoneSensorType.MOTION]:            { primaryCapability: 'alarm_motion', deviceClass: 'sensor' },
  [ZoneSensorType.PANEL_MOTION]:      { primaryCapability: 'alarm_motion', deviceClass: 'sensor' },
  [ZoneSensorType.OCCUPANCY]:         { primaryCapability: 'alarm_motion', deviceClass: 'sensor' },
  [ZoneSensorType.SMOKE_DETECTOR]:    { primaryCapability: 'alarm_smoke', deviceClass: 'sensor' },
  [ZoneSensorType.SMOKE_M]:           { primaryCapability: 'alarm_smoke', deviceClass: 'sensor' },
  [ZoneSensorType.CO_DETECTOR]:       { primaryCapability: 'alarm_co', deviceClass: 'sensor' },
  [ZoneSensorType.WATER]:             { primaryCapability: 'alarm_water', deviceClass: 'sensor' },
  [ZoneSensorType.GLASS_BREAK]:       { primaryCapability: 'alarm_generic', deviceClass: 'sensor' },
  [ZoneSensorType.PANEL_GLASS_BREAK]: { primaryCapability: 'alarm_generic', deviceClass: 'sensor' },
  [ZoneSensorType.FREEZE]:            { primaryCapability: 'alarm_generic', deviceClass: 'sensor' },
  [ZoneSensorType.HEAT]:              { primaryCapability: 'alarm_generic', deviceClass: 'sensor' },
  [ZoneSensorType.HIGH_TEMPERATURE]:  { primaryCapability: 'alarm_generic', deviceClass: 'sensor' },
  [ZoneSensorType.SHOCK]:             { primaryCapability: 'alarm_generic', deviceClass: 'sensor' },
  [ZoneSensorType.DOORBELL]:          { primaryCapability: 'alarm_generic', deviceClass: 'sensor' },
  [ZoneSensorType.AUXILIARY_PENDANT]: { primaryCapability: 'alarm_generic', deviceClass: 'sensor' },
  [ZoneSensorType.KEY_FOB]:           { primaryCapability: 'alarm_generic', deviceClass: 'sensor' },
  [ZoneSensorType.SIREN]:             { primaryCapability: 'alarm_generic', deviceClass: 'sensor' },
  [ZoneSensorType.TAKEOVER_MODULE]:   { primaryCapability: 'alarm_generic', deviceClass: 'sensor' },
  [ZoneSensorType.TAMPER]:            { primaryCapability: 'alarm_generic', deviceClass: 'sensor' },
  [ZoneSensorType.TEMPERATURE]:       { primaryCapability: 'alarm_generic', deviceClass: 'sensor' },
  [ZoneSensorType.TRANSLATOR]:        { primaryCapability: 'alarm_generic', deviceClass: 'sensor' },
};

/** Get the full list of Homey capabilities for a zone based on its sensor type. */
export function getCapabilitiesForZone(sensorType: string, hasPowergTemp?: boolean, hasPowergLight?: boolean): string[] {
  const mapping = ZONE_TYPE_MAP[sensorType];
  const capabilities: string[] = [];

  if (mapping) {
    capabilities.push(mapping.primaryCapability);
  } else {
    capabilities.push('alarm_generic');
  }

  capabilities.push('alarm_tamper');
  capabilities.push('alarm_battery');

  if (hasPowergTemp) {
    capabilities.push('measure_temperature');
  }
  if (hasPowergLight) {
    capabilities.push('measure_luminance');
  }

  return capabilities;
}

/** Get the Homey device class for a zone sensor type. */
export function getDeviceClassForZone(sensorType: string): string {
  const mapping = ZONE_TYPE_MAP[sensorType];
  return mapping?.deviceClass ?? 'sensor';
}

/** Statuses that mean the zone's primary alarm capability should be true. */
const ACTIVE_STATUSES: Set<string> = new Set([
  ZoneStatus.OPEN,
  ZoneStatus.ACTIVE,
  ZoneStatus.ACTIVATED,
  ZoneStatus.ALARMED,
  ZoneStatus.OCCUPIED,
]);

/** Returns true if the zone status means the primary alarm capability is triggered. */
export function isZoneActive(status: string): boolean {
  return ACTIVE_STATUSES.has(status);
}

/** Sensor types that should be filtered out during zone pairing (not real sensors). */
const EXCLUDED_SENSOR_TYPES: Set<string> = new Set([
  ZoneSensorType.KEYPAD,
  ZoneSensorType.BLUETOOTH,
  ZoneSensorType.TAKEOVER_MODULE,
]);

/** Returns true if this sensor type should be included as a Homey device. */
export function shouldIncludeZone(sensorType: string): boolean {
  return !EXCLUDED_SENSOR_TYPES.has(sensorType);
}
