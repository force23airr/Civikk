import type {
  EventType,
  MediaClip,
  MediaClipStatus,
  RoadEvent,
  Severity,
  Source,
  Trip
} from "@civik/types";
import {
  EventType as DbEventType,
  MediaClipStatus as DbMediaClipStatus,
  Severity as DbSeverity,
  Source as DbSource
} from "@civik/db";

export const toDbEventType: Record<EventType, DbEventType> = {
  pothole: DbEventType.POTHOLE,
  debris: DbEventType.DEBRIS,
  hard_brake: DbEventType.HARD_BRAKE,
  crash: DbEventType.CRASH,
  reckless_driver: DbEventType.RECKLESS_DRIVER,
  flooding: DbEventType.FLOODING,
  dangerous_intersection: DbEventType.DANGEROUS_INTERSECTION,
  road_obstruction: DbEventType.ROAD_OBSTRUCTION
};

export const fromDbEventType: Record<DbEventType, EventType> = {
  [DbEventType.POTHOLE]: "pothole",
  [DbEventType.DEBRIS]: "debris",
  [DbEventType.HARD_BRAKE]: "hard_brake",
  [DbEventType.CRASH]: "crash",
  [DbEventType.RECKLESS_DRIVER]: "reckless_driver",
  [DbEventType.FLOODING]: "flooding",
  [DbEventType.DANGEROUS_INTERSECTION]: "dangerous_intersection",
  [DbEventType.ROAD_OBSTRUCTION]: "road_obstruction"
};

export const toDbSeverity: Record<Severity, DbSeverity> = {
  low: DbSeverity.LOW,
  medium: DbSeverity.MEDIUM,
  high: DbSeverity.HIGH,
  critical: DbSeverity.CRITICAL
};

export const fromDbSeverity: Record<DbSeverity, Severity> = {
  [DbSeverity.LOW]: "low",
  [DbSeverity.MEDIUM]: "medium",
  [DbSeverity.HIGH]: "high",
  [DbSeverity.CRITICAL]: "critical"
};

export const toDbSource: Record<Source, DbSource> = {
  manual: DbSource.MANUAL,
  sensor: DbSource.SENSOR,
  ml: DbSource.ML
};

export const fromDbSource: Record<DbSource, Source> = {
  [DbSource.MANUAL]: "manual",
  [DbSource.SENSOR]: "sensor",
  [DbSource.ML]: "ml"
};

export const toDbMediaClipStatus: Record<MediaClipStatus, DbMediaClipStatus> = {
  pending_upload: DbMediaClipStatus.PENDING_UPLOAD,
  uploaded: DbMediaClipStatus.UPLOADED,
  failed: DbMediaClipStatus.FAILED
};

export const fromDbMediaClipStatus: Record<DbMediaClipStatus, MediaClipStatus> = {
  [DbMediaClipStatus.PENDING_UPLOAD]: "pending_upload",
  [DbMediaClipStatus.UPLOADED]: "uploaded",
  [DbMediaClipStatus.FAILED]: "failed"
};

export function serializeTrip(trip: {
  id: string;
  userId: string;
  deviceId: string | null;
  startedAt: Date;
  endedAt: Date | null;
  startLat: number | null;
  startLng: number | null;
  endLat: number | null;
  endLng: number | null;
  createdAt: Date;
  updatedAt: Date;
}): Trip {
  return {
    ...trip,
    startedAt: trip.startedAt.toISOString(),
    endedAt: trip.endedAt?.toISOString() ?? null,
    createdAt: trip.createdAt.toISOString(),
    updatedAt: trip.updatedAt.toISOString()
  };
}

export function serializeRoadEvent(event: {
  id: string;
  tripId: string | null;
  userId: string;
  type: DbEventType;
  lat: number;
  lng: number;
  speedMph: number | null;
  accuracyMeters: number | null;
  source: DbSource;
  severity: DbSeverity;
  confidence: number;
  createdAt: Date;
  updatedAt: Date;
}): RoadEvent {
  return {
    ...event,
    type: fromDbEventType[event.type],
    source: fromDbSource[event.source],
    severity: fromDbSeverity[event.severity],
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString()
  };
}

export function serializeMediaClip(clip: {
  id: string;
  userId: string;
  tripId: string;
  roadEventId: string | null;
  name: string | null;
  status: DbMediaClipStatus;
  localUri: string | null;
  storageKey: string | null;
  mimeType: string;
  durationSeconds: number | null;
  sizeBytes: number | null;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): MediaClip {
  return {
    ...clip,
    status: fromDbMediaClipStatus[clip.status],
    startedAt: clip.startedAt?.toISOString() ?? null,
    endedAt: clip.endedAt?.toISOString() ?? null,
    createdAt: clip.createdAt.toISOString(),
    updatedAt: clip.updatedAt.toISOString()
  };
}
