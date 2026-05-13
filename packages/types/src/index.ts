export const eventTypes = [
  "pothole",
  "debris",
  "hard_brake",
  "crash",
  "reckless_driver",
  "flooding",
  "dangerous_intersection",
  "road_obstruction"
] as const;

export const severities = ["low", "medium", "high", "critical"] as const;

export const sources = ["manual", "sensor", "ml"] as const;

export const mediaClipStatuses = [
  "pending_upload",
  "uploaded",
  "failed"
] as const;

export const municipalReportStatuses = [
  "not_submitted",
  "queued",
  "submitted",
  "acknowledged",
  "resolved"
] as const;

export type EventType = (typeof eventTypes)[number];
export type Severity = (typeof severities)[number];
export type Source = (typeof sources)[number];
export type MediaClipStatus = (typeof mediaClipStatuses)[number];
export type MunicipalReportStatus = (typeof municipalReportStatuses)[number];

export interface Trip {
  id: string;
  userId: string;
  deviceId?: string | null;
  startedAt: string;
  endedAt?: string | null;
  startLat?: number | null;
  startLng?: number | null;
  endLat?: number | null;
  endLng?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TripSummary extends Trip {
  mediaClipCount: number;
  roadEventCount: number;
}

export interface MediaClip {
  id: string;
  userId: string;
  tripId: string;
  roadEventId?: string | null;
  name?: string | null;
  status: MediaClipStatus;
  localUri?: string | null;
  storageKey?: string | null;
  mimeType: string;
  durationSeconds?: number | null;
  sizeBytes?: number | null;
  lat?: number | null;
  lng?: number | null;
  accuracyMeters?: number | null;
  speedMph?: number | null;
  startedAt?: string | null;
  endedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoadEvent {
  id: string;
  tripId?: string | null;
  userId: string;
  type: EventType;
  lat: number;
  lng: number;
  speedMph?: number | null;
  accuracyMeters?: number | null;
  source: Source;
  severity: Severity;
  confidence: number;
  note?: string | null;
  photoLocalUri?: string | null;
  photoStorageKey?: string | null;
  municipalStatus: MunicipalReportStatus;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  email?: string | null;
  name?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Alert {
  id: string;
  roadEventId: string;
  message: string;
  resolvedAt?: string | null;
  createdAt: string;
}

export interface StartTripInput {
  deviceId?: string;
  lat?: number;
  lng?: number;
}

export interface EndTripInput {
  lat?: number;
  lng?: number;
}

export interface CreateRoadEventInput {
  tripId?: string;
  type: EventType;
  lat: number;
  lng: number;
  speedMph?: number;
  accuracyMeters?: number;
  source?: Source;
  severity?: Severity;
  confidence?: number;
  note?: string;
  photoLocalUri?: string;
  municipalStatus?: MunicipalReportStatus;
}

export interface CreateMediaClipInput {
  tripId: string;
  roadEventId?: string;
  localUri?: string;
  mimeType?: string;
  durationSeconds?: number;
  sizeBytes?: number;
  lat?: number;
  lng?: number;
  accuracyMeters?: number;
  speedMph?: number;
  startedAt?: string;
  endedAt?: string;
}

export interface CompleteMediaClipInput {
  storageKey: string;
  sizeBytes?: number;
}
