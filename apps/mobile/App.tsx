import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import type { EventType, RoadEvent, Trip } from "@civik/types";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
const ACTIVE_TRIP_STORAGE_KEY = "civik.activeTrip";
const PENDING_EVENTS_STORAGE_KEY = "civik.pendingRoadEvents";

type ApiStatus = {
  message: string;
  tone: "idle" | "success" | "error";
};

type RoadEventPayload = {
  tripId?: string;
  type: EventType;
  lat: number;
  lng: number;
  speedMph?: number;
  accuracyMeters?: number;
  source: "manual";
  severity: "medium" | "high";
  confidence: number;
};

type PendingRoadEvent = {
  id: string;
  idempotencyKey: string;
  payload: RoadEventPayload;
  createdAt: string;
};

function makeIdempotencyKey(action: string) {
  return `${action}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function getCurrentCoordinates() {
  const permission = await Location.requestForegroundPermissionsAsync();

  if (permission.status !== "granted") {
    throw new Error("Location permission is required to record trips and events.");
  }

  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High
  });

  return {
    lat: location.coords.latitude,
    lng: location.coords.longitude,
    speedMph:
      typeof location.coords.speed === "number" && location.coords.speed >= 0
        ? location.coords.speed * 2.23694
        : undefined,
    accuracyMeters: location.coords.accuracy ?? undefined
  };
}

async function postJson<T>(
  path: string,
  body: unknown,
  idempotencyKey = makeIdempotencyKey(path)
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`API request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function loadActiveTrip() {
  const value = await AsyncStorage.getItem(ACTIVE_TRIP_STORAGE_KEY);
  return value ? (JSON.parse(value) as Trip) : null;
}

async function saveActiveTrip(trip: Trip | null) {
  if (trip && !trip.endedAt) {
    await AsyncStorage.setItem(ACTIVE_TRIP_STORAGE_KEY, JSON.stringify(trip));
    return;
  }

  await AsyncStorage.removeItem(ACTIVE_TRIP_STORAGE_KEY);
}

async function loadPendingEvents() {
  const value = await AsyncStorage.getItem(PENDING_EVENTS_STORAGE_KEY);
  return value ? (JSON.parse(value) as PendingRoadEvent[]) : [];
}

async function savePendingEvents(events: PendingRoadEvent[]) {
  await AsyncStorage.setItem(PENDING_EVENTS_STORAGE_KEY, JSON.stringify(events));
}

export default function App() {
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [lastEvent, setLastEvent] = useState<RoadEvent | null>(null);
  const [pendingEvents, setPendingEvents] = useState<PendingRoadEvent[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [status, setStatus] = useState<ApiStatus>({
    message: "Loading trip state.",
    tone: "idle"
  });

  const isRecording = useMemo(
    () => Boolean(activeTrip && !activeTrip.endedAt),
    [activeTrip]
  );

  const persistActiveTrip = useCallback(async (trip: Trip | null) => {
    setActiveTrip(trip);
    await saveActiveTrip(trip);
  }, []);

  const persistPendingEvents = useCallback(async (events: PendingRoadEvent[]) => {
    setPendingEvents(events);
    await savePendingEvents(events);
  }, []);

  const syncPendingEvents = useCallback(async () => {
    const queued = await loadPendingEvents();

    if (queued.length === 0) {
      setPendingEvents([]);
      return;
    }

    setIsSyncing(true);
    const remaining: PendingRoadEvent[] = [];
    let syncedCount = 0;
    let latestEvent: RoadEvent | null = null;

    for (const event of queued) {
      try {
        const data = await postJson<{ roadEvent: RoadEvent }>(
          "/api/road-events",
          event.payload,
          event.idempotencyKey
        );
        latestEvent = data.roadEvent;
        syncedCount += 1;
      } catch {
        remaining.push(event);
      }
    }

    await persistPendingEvents(remaining);

    if (latestEvent) {
      setLastEvent(latestEvent);
    }

    if (syncedCount > 0) {
      setStatus({
        message:
          remaining.length > 0
            ? `Synced ${syncedCount} report. ${remaining.length} still queued.`
            : `Synced ${syncedCount} queued report${syncedCount === 1 ? "" : "s"}.`,
        tone: remaining.length > 0 ? "idle" : "success"
      });
    }

    setIsSyncing(false);
  }, [persistPendingEvents]);

  useEffect(() => {
    let isMounted = true;

    async function restoreState() {
      try {
        const [storedTrip, storedEvents] = await Promise.all([
          loadActiveTrip(),
          loadPendingEvents()
        ]);

        if (!isMounted) {
          return;
        }

        setActiveTrip(storedTrip);
        setPendingEvents(storedEvents);
        setStatus({
          message: storedTrip ? "Trip resumed." : "Ready to record.",
          tone: storedTrip ? "success" : "idle"
        });

        void syncPendingEvents();
      } catch {
        if (isMounted) {
          setStatus({
            message: "Could not restore local trip state.",
            tone: "error"
          });
        }
      }
    }

    void restoreState();

    return () => {
      isMounted = false;
    };
  }, [syncPendingEvents]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void syncPendingEvents();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [syncPendingEvents]);

  async function startTrip() {
    setIsBusy(true);
    try {
      const coordinates = await getCurrentCoordinates();
      const data = await postJson<{ trip: Trip }>("/api/trips/start", coordinates);
      await persistActiveTrip(data.trip);
      setStatus({ message: "Trip started.", tone: "success" });
    } catch (error) {
      setStatus({
        message: error instanceof Error ? error.message : "Could not start trip.",
        tone: "error"
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function stopTrip() {
    if (!activeTrip) {
      return;
    }

    setIsBusy(true);
    try {
      const coordinates = await getCurrentCoordinates();
      const data = await postJson<{ trip: Trip }>(
        `/api/trips/${activeTrip.id}/end`,
        coordinates
      );
      await persistActiveTrip(data.trip);
      setStatus({ message: "Trip stopped.", tone: "success" });
    } catch (error) {
      setStatus({
        message: error instanceof Error ? error.message : "Could not stop trip.",
        tone: "error"
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function reportEvent(type: EventType) {
    setIsBusy(true);
    const idempotencyKey = makeIdempotencyKey("/api/road-events");
    const coordinates = await getCurrentCoordinates().catch((error) => {
      setStatus({
        message: error instanceof Error ? error.message : "Could not capture GPS.",
        tone: "error"
      });
      return null;
    });

    if (!coordinates) {
      setIsBusy(false);
      return;
    }

    const payload: RoadEventPayload = {
      tripId: activeTrip?.id,
      type,
      severity: type === "crash" ? "high" : "medium",
      source: "manual",
      confidence: 1,
      ...coordinates
    };

    try {
      const data = await postJson<{ roadEvent: RoadEvent }>(
        "/api/road-events",
        payload,
        idempotencyKey
      );

      setLastEvent(data.roadEvent);
      setStatus({ message: `${type.replace("_", " ")} reported.`, tone: "success" });
    } catch {
      const nextQueue = [
        ...pendingEvents,
        {
          id: makeIdempotencyKey("queued-event"),
          idempotencyKey,
          payload,
          createdAt: new Date().toISOString()
        }
      ];

      await persistPendingEvents(nextQueue);
      setStatus({
        message: `${type.replace("_", " ")} saved locally. It will retry when connected.`,
        tone: "idle"
      });
    } finally {
      setIsBusy(false);
      void syncPendingEvents();
    }
  }

  async function retryQueuedReports() {
    setStatus({
      message: "Retrying queued reports.",
      tone: "idle"
    });
    await syncPendingEvents();
  }

  function tripStartedLabel() {
    if (!activeTrip) {
      return "No active trip.";
    }

    return `Started: ${new Date(activeTrip.startedAt).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    })}`;
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Civik Drive</Text>
          <Text style={styles.subtitle}>
            {isRecording
              ? "Trip state is saved on this phone if the app is interrupted."
              : "Trip recording and manual road reports."}
          </Text>
        </View>

        <View style={styles.statusPanel}>
          <View style={styles.statusHeader}>
            <Text style={styles.label}>Status</Text>
            {isRecording ? <Text style={styles.recordingPill}>Recording</Text> : null}
          </View>
          <Text style={[styles.statusText, styles[status.tone]]}>
            {status.message}
          </Text>
          {activeTrip ? (
            <>
              <Text style={styles.meta}>Trip ID: {activeTrip.id}</Text>
              <Text style={styles.meta}>{tripStartedLabel()}</Text>
            </>
          ) : (
            <Text style={styles.meta}>No active trip.</Text>
          )}
          {pendingEvents.length > 0 ? (
            <Text style={styles.queueText}>
              {pendingEvents.length} queued report
              {pendingEvents.length === 1 ? "" : "s"} pending sync.
            </Text>
          ) : null}
          {lastEvent ? (
            <Text style={styles.meta}>Last event: {lastEvent.type}</Text>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Pressable
            disabled={isBusy || isRecording}
            onPress={startTrip}
            style={({ pressed }) => [
              styles.button,
              styles.primaryButton,
              (pressed || isBusy || isRecording) && styles.buttonDisabled
            ]}
          >
            <Text style={styles.primaryButtonText}>Record</Text>
          </Pressable>

          <Pressable
            disabled={isBusy || !isRecording}
            onPress={stopTrip}
            style={({ pressed }) => [
              styles.button,
              styles.secondaryButton,
              (pressed || isBusy || !isRecording) && styles.buttonDisabled
            ]}
          >
            <Text style={styles.secondaryButtonText}>Stop Recording</Text>
          </Pressable>
        </View>

        <View style={styles.reportGrid}>
          <Pressable
            disabled={isBusy}
            onPress={() => reportEvent("pothole")}
            style={({ pressed }) => [
              styles.reportButton,
              (pressed || isBusy) && styles.buttonDisabled
            ]}
          >
            <Text style={styles.reportButtonText}>Report Pothole</Text>
          </Pressable>

          <Pressable
            disabled={isBusy}
            onPress={() => reportEvent("debris")}
            style={({ pressed }) => [
              styles.reportButton,
              (pressed || isBusy) && styles.buttonDisabled
            ]}
          >
            <Text style={styles.reportButtonText}>Report Debris</Text>
          </Pressable>

          <Pressable
            disabled={isBusy}
            onPress={() => reportEvent("crash")}
            style={({ pressed }) => [
              styles.reportButton,
              styles.dangerButton,
              (pressed || isBusy) && styles.buttonDisabled
            ]}
          >
            <Text style={styles.dangerButtonText}>Report Crash</Text>
          </Pressable>
        </View>

        {pendingEvents.length > 0 ? (
          <Pressable
            disabled={isSyncing}
            onPress={retryQueuedReports}
            style={({ pressed }) => [
              styles.button,
              styles.queueButton,
              (pressed || isSyncing) && styles.buttonDisabled
            ]}
          >
            <Text style={styles.queueButtonText}>
              {isSyncing ? "Syncing Reports" : "Retry Queued Reports"}
            </Text>
          </Pressable>
        ) : null}

        {isBusy || isSyncing ? (
          <View style={styles.loading}>
            <ActivityIndicator />
            <Text style={styles.meta}>
              {isSyncing ? "Syncing queued reports." : "Working with location and API."}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f5f7f8"
  },
  content: {
    gap: 20,
    padding: 20
  },
  header: {
    gap: 6,
    paddingTop: 24
  },
  title: {
    color: "#172026",
    fontSize: 34,
    fontWeight: "800"
  },
  subtitle: {
    color: "#51606a",
    fontSize: 16,
    lineHeight: 22
  },
  statusPanel: {
    backgroundColor: "#ffffff",
    borderColor: "#dce3e8",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 16
  },
  statusHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  label: {
    color: "#6a7780",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  recordingPill: {
    backgroundColor: "#e9f7ef",
    borderColor: "#9bd7b2",
    borderRadius: 999,
    borderWidth: 1,
    color: "#157347",
    fontSize: 12,
    fontWeight: "800",
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  statusText: {
    fontSize: 18,
    fontWeight: "700"
  },
  idle: {
    color: "#172026"
  },
  success: {
    color: "#157347"
  },
  error: {
    color: "#b42318"
  },
  meta: {
    color: "#51606a",
    fontSize: 13
  },
  queueText: {
    color: "#8a5a00",
    fontSize: 13,
    fontWeight: "700"
  },
  actions: {
    gap: 12
  },
  button: {
    alignItems: "center",
    borderRadius: 8,
    minHeight: 52,
    justifyContent: "center",
    paddingHorizontal: 16
  },
  primaryButton: {
    backgroundColor: "#0b5cab"
  },
  secondaryButton: {
    backgroundColor: "#ffffff",
    borderColor: "#0b5cab",
    borderWidth: 1
  },
  queueButton: {
    backgroundColor: "#fff8e6",
    borderColor: "#e6b450",
    borderWidth: 1
  },
  buttonDisabled: {
    opacity: 0.45
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800"
  },
  secondaryButtonText: {
    color: "#0b5cab",
    fontSize: 16,
    fontWeight: "800"
  },
  queueButtonText: {
    color: "#8a5a00",
    fontSize: 16,
    fontWeight: "800"
  },
  reportGrid: {
    gap: 12
  },
  reportButton: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#b8c4cc",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 50,
    justifyContent: "center",
    paddingHorizontal: 16
  },
  reportButtonText: {
    color: "#172026",
    fontSize: 15,
    fontWeight: "800"
  },
  dangerButton: {
    borderColor: "#b42318"
  },
  dangerButtonText: {
    color: "#b42318",
    fontSize: 15,
    fontWeight: "800"
  },
  loading: {
    alignItems: "center",
    gap: 8,
    padding: 16
  }
});
