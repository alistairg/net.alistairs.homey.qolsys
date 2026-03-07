/**
 * Maps Qolsys sensor types to their typical battery type.
 * Based on DSC PowerG sensor specifications.
 *
 * Sources:
 * - DSC PowerG product datasheets
 * - Qolsys IQ Pro compatible device list
 */

const BATTERY_TYPE_MAP: Record<string, string> = {
  // Door/Window sensors (PG9303, PG9307, PG9309, PG9312)
  Door_Window: 'CR2032',
  Door_Window_M: 'CR2032',
  Tilt: 'CR2032',

  // Motion sensors (PG9914, PG9924, PG9984, PG9994)
  Motion: 'CR123A',
  'Panel Motion': '',       // built-in, no battery
  'Occupancy Sensor': 'CR123A',

  // Glass break (PG9922, PG9926)
  GlassBreak: 'CR123A x2',
  'Panel Glass Break': '',  // built-in, no battery

  // Smoke/heat detectors (PG9916, PG9926, PG9936)
  SmokeDetector: 'CR123A x2',
  Smoke_M: 'CR123A x2',
  Heat: 'CR123A',
  'High Temperature': 'CR123A',

  // CO detector (PG9913, PG9933)
  CODetector: 'CR123A x2',

  // Water/flood (PG9985)
  Water: 'CR2032',

  // Freeze sensor (PG9905)
  Freeze: 'CR2032',

  // Shock sensor (PG9935)
  Shock: 'CR123A',

  // Key fob (PG9929, PG9939, PG9949)
  KeyFob: 'CR2032',

  // Auxiliary pendant (PG9938, PG9928)
  'Auxiliary Pendant': 'CR2032',

  // Siren (PG9901, PG9911)
  Siren: '3V CR123A x4',

  // Doorbell
  Doorbell: 'CR2032',
};

/** Get the battery type string for a sensor type. Returns empty string if unknown/not applicable. */
export function getBatteryType(sensorType: string): string {
  return BATTERY_TYPE_MAP[sensorType] || '';
}
