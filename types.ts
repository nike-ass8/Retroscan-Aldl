
export type TelemetryValue = number | string;

export interface ECMData {
  [key: string]: TelemetryValue;
}

export type GaugeTheme = 'neon' | 'carbon' | 'retro';

export interface GaugeConfig {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  color: string;
  field: string;
}

export interface ADXBit {
  id: string;
  title: string;
  packetOffset: number;
  bitOffset: number;
}

export interface ADXParameter {
  id: string;
  title: string;
  units: string;
  packetOffset: number;
  byteCount: number;
  scale?: number;
  offset?: number;
}

export interface ADXFile {
  id: string;
  name: string;
  mask: string;
  description: string;
  gauges: GaugeConfig[];
  parameters: ADXParameter[];
  bits: ADXBit[];
  initialData: ECMData;
  requestCommand?: number[];
  clearCodesCommand?: number[];
  expectedPacketLength?: number;
  baudRate?: number;
  echoCancel?: boolean; // Ny inställning för echo cancellation
}

export enum AppTab {
  DASHBOARD = 'dashboard',
  DATA_LIST = 'data_list',
  DTC_LIST = 'dtc_list',
  CONNECTION = 'connection',
  THEME_SELECT = 'theme_select'
}
