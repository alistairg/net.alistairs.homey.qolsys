// Enums and interfaces derived from QolsysController/qolsys_controller/enum.py

// --- Partition enums ---

export enum PartitionSystemStatus {
  ARM_STAY = 'ARM-STAY',
  ARM_AWAY = 'ARM-AWAY',
  ARM_NIGHT = 'ARM-NIGHT',
  DISARM = 'DISARM',
  ARM_AWAY_EXIT_DELAY = 'ARM-AWAY-EXIT-DELAY',
  ARM_STAY_EXIT_DELAY = 'ARM-STAY-EXIT-DELAY',
  ARM_NIGHT_EXIT_DELAY = 'ARM-NIGHT-EXIT-DELAY',
  UNKNOWN = 'UNKNOWN',
}

export enum PartitionArmingType {
  ARM_STAY = 'ui_armstay',
  ARM_AWAY = 'ui_armaway',
  ARM_NIGHT = 'ui_armnight',
}

export enum PartitionAlarmState {
  NONE = 'None',
  DELAY = 'Delay',
  ALARM = 'Alarm',
  UNKNOWN = 'UNKNOWN',
}

export enum PartitionAlarmType {
  POLICE_EMERGENCY = 'Police Emergency',
  FIRE_EMERGENCY = 'Fire Emergency',
  GAZ_CO = 'co',
  AUXILIARY_EMERGENCY = 'Auxiliary Emergency',
  SILENT_AUXILIARY_EMERGENCY = 'Silent Auxiliary Emergency',
  SILENT_POLICE_EMERGENCY = 'Silent Police Emergency',
  GLASS_BREAK_AWAY_ONLY = 'glassbreakawayonly',
  GLASS_BREAK = 'glassbreak',
  ENTRY_EXIT_NORMAL_DELAY = 'entryexitdelay',
  ENTRY_EXIT_LONG_DELAY = 'entryexitlongdelay',
  INSTANT_PERIMETER_DW = 'instantperimeter',
  INSTANT_INTERIOR_DOOR = 'instantinterior',
  AWAY_INSTANT_FOLLOWER_DELAY = 'awayinstantfollowerdelay',
  REPORTING_SAFETY_SENSOR = 'reportingsafety',
  DELAYED_REPORTING_SAFETY_SENSOR = 'delayedreportingsafety',
  AWAY_INSTANT_MOTION = 'awayinstantmotion',
  SMOKE_HEAT = 'smoke_heat',
  STAY_INSTANT_MOTION = 'stayinstantmotion',
  STAY_DELAY_MOTION = 'staydelaymotion',
  AWAY_DELAY_MOTION = 'awaydelaymotion',
  SHOCK = 'shock',
  WATER_SENSOR = 'WaterSensor',
}

// --- Zone enums ---

export enum ZoneSensorType {
  AUXILIARY_PENDANT = 'Auxiliary Pendant',
  BLUETOOTH = 'Bluetooth',
  CO_DETECTOR = 'CODetector',
  DOORBELL = 'Doorbell',
  DOOR_WINDOW = 'Door_Window',
  DOOR_WINDOW_M = 'Door_Window_M',
  FREEZE = 'Freeze',
  GLASS_BREAK = 'GlassBreak',
  HEAT = 'Heat',
  HIGH_TEMPERATURE = 'High Temperature',
  KEY_FOB = 'KeyFob',
  KEYPAD = 'Keypad',
  MOTION = 'Motion',
  OCCUPANCY = 'Occupancy Sensor',
  PANEL_GLASS_BREAK = 'Panel Glass Break',
  PANEL_MOTION = 'Panel Motion',
  SIREN = 'Siren',
  SHOCK = 'Shock',
  SMOKE_DETECTOR = 'SmokeDetector',
  SMOKE_M = 'Smoke_M',
  TAKEOVER_MODULE = 'TakeoverModule',
  TAMPER = 'Tamper Sensor',
  TEMPERATURE = 'Temperature',
  TILT = 'Tilt',
  TRANSLATOR = 'Translator',
  UNKNOWN = 'Unknown',
  WATER = 'Water',
}

export enum ZoneStatus {
  ACTIVE = 'Active',
  ACTIVATED = 'Activated',
  ALARMED = 'Alarmed',
  ARM_AWAY = 'Arm-Away',
  ARM_STAY = 'Arm-Stay',
  AUXILIARY_EMERGENCY = 'Auxiliary Emergency',
  BELL_TROUBLE = 'Bell Trouble',
  CLOSED = 'Closed',
  CONNECTED = 'connected',
  DISARM = 'Disarm',
  FAILURE = 'Failure',
  FIRE_EMERGENCY = 'Fire Emergency',
  OPEN = 'Open',
  OCCUPIED = 'Occupied',
  POLICE_EMERGENCY = 'Police Emergency',
  INACTIVE = 'Inactive',
  IDLE = 'Idle',
  NORMAL = 'Normal',
  UNREACHABLE = 'Unreachable',
  SILENT_POLICE_EMERGENCY = 'Silent Police Emergency',
  SILENT_AUXILIARY_EMERGENCY = 'Silent Auxiliary Emergency',
  TAMPERED = 'Tampered',
  SYNCHRONIZING = 'Synchronizing',
  DISCONNECTED = 'disconnected',
  NOT_NETWORKED = 'Not Networked',
  TROUBLE = 'Trouble',
  VACANT = 'Vacant',
}

// --- Data interfaces ---

export interface QolsysPartitionData {
  partitionId: string;
  name: string;
  systemStatus: PartitionSystemStatus;
  alarmState: PartitionAlarmState;
  alarmTypes: string[];
  exitSounds: string;
  entryDelays: string;
}

export interface QolsysZoneData {
  zoneId: string;
  shortID: string;
  sensorName: string;
  sensorType: string;
  sensorStatus: ZoneStatus;
  sensorGroup: string;
  partitionId: string;
  batteryStatus: string;
  acStatus: string;
  latestdBm: string;
  averagedBm: string;
  currentCapability: string;
  // PowerG extras (from PowerGDeviceContentProvider)
  powergTemperature?: number;
  powergLight?: number;
}

export interface QolsysPanelInfo {
  imei: string;
  productType: string;
  hardwareVersion: string;
  androidVersion: string;
  acStatus: string;
  tamperState: string;
  batteryStatus: string;
}
