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

export type EventType = (typeof eventTypes)[number];
export type Severity = (typeof severities)[number];
export type Source = (typeof sources)[number];

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
}
