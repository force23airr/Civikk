import AsyncStorage from "@react-native-async-storage/async-storage";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import * as FileSystem from "expo-file-system";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import type {
  EventType,
  MediaClip,
  RoadEvent,
  Trip,
  TripSummary
} from "@civik/types";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
const ACTIVE_TRIP_STORAGE_KEY = "civik.activeTrip";
const PENDING_EVENTS_STORAGE_KEY = "civik.pendingRoadEvents";
const ROLLING_CLIP_SECONDS = 30;
const CLIP_DIRECTORY = `${FileSystem.documentDirectory ?? ""}civik-clips/`;

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

type ClipCapture = {
  startedAt: string;
  endedAt: string;
  uri: string;
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

async function persistClipFile(uri: string) {
  if (!FileSystem.documentDirectory) {
    return uri;
  }

  await FileSystem.makeDirectoryAsync(CLIP_DIRECTORY, { intermediates: true });
  const extension = uri.split(".").pop()?.split("?")[0] || "mp4";
  const destination = `${CLIP_DIRECTORY}${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}.${extension}`;

  await FileSystem.copyAsync({
    from: uri,
    to: destination
  });

  return destination;
}

export default function App() {
  const cameraRef = useRef<CameraView | null>(null);
  const activeTripRef = useRef<Trip | null>(null);
  const recordingPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(
    null
  );
  const shouldContinueRecordingRef = useRef(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] =
    useMicrophonePermissions();
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [lastEvent, setLastEvent] = useState<RoadEvent | null>(null);
  const [lastClip, setLastClip] = useState<MediaClip | null>(null);
  const [pendingEvents, setPendingEvents] = useState<PendingRoadEvent[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isCapturingVideo, setIsCapturingVideo] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyTrips, setHistoryTrips] = useState<TripSummary[]>([]);
  const [historyState, setHistoryState] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [status, setStatus] = useState<ApiStatus>({
    message: "Loading trip state.",
    tone: "idle"
  });

  const isRecording = useMemo(
    () => Boolean(activeTrip && !activeTrip.endedAt),
    [activeTrip]
  );

  const hasCameraAccess =
    cameraPermission?.granted === true && microphonePermission?.granted === true;

  const persistActiveTrip = useCallback(async (trip: Trip | null) => {
    activeTripRef.current = trip;
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

        activeTripRef.current = storedTrip;
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

  async function requestRecordingPermissions() {
    const [camera, microphone] = await Promise.all([
      cameraPermission?.granted
        ? Promise.resolve(cameraPermission)
        : requestCameraPermission(),
      microphonePermission?.granted
        ? Promise.resolve(microphonePermission)
        : requestMicrophonePermission()
    ]);

    if (!camera.granted || !microphone.granted) {
      throw new Error("Camera and microphone permissions are required for footage.");
    }
  }

  async function createMediaClip(tripId: string, clip: ClipCapture) {
    const localUri = await persistClipFile(clip.uri);
    const durationSeconds =
      (new Date(clip.endedAt).getTime() - new Date(clip.startedAt).getTime()) /
      1000;

    const data = await postJson<{ mediaClip: MediaClip }>("/api/media/clips", {
      tripId,
      localUri,
      mimeType: "video/mp4",
      durationSeconds: Math.max(1, Math.round(durationSeconds)),
      startedAt: clip.startedAt,
      endedAt: clip.endedAt
    });

    setLastClip(data.mediaClip);
    return data.mediaClip;
  }

  const startVideoCapture = useCallback(async (tripId: string) => {
    if (!cameraRef.current || !isCameraReady || isCapturingVideo) {
      if (!cameraRef.current || !isCameraReady) {
        throw new Error("Camera is still getting ready.");
      }

      return;
    }

    shouldContinueRecordingRef.current = true;
    const startedAt = new Date().toISOString();
    setIsCapturingVideo(true);

    const recordingPromise = cameraRef.current.recordAsync({
      maxDuration: ROLLING_CLIP_SECONDS
    });

    recordingPromiseRef.current = recordingPromise;
    recordingPromise
      .then(async (video) => {
        if (!video?.uri) {
          return;
        }

        await createMediaClip(tripId, {
          startedAt,
          endedAt: new Date().toISOString(),
          uri: video.uri
        });
      })
      .catch((error) => {
        setStatus({
          message:
            error instanceof Error ? error.message : "Could not save video clip.",
          tone: "error"
        });
      })
      .finally(() => {
        recordingPromiseRef.current = null;
        setIsCapturingVideo(false);

        if (
          shouldContinueRecordingRef.current &&
          activeTripRef.current?.id === tripId &&
          !activeTripRef.current.endedAt
        ) {
          setTimeout(() => {
            void startVideoCapture(tripId).catch((error) => {
              setStatus({
                message:
                  error instanceof Error
                    ? error.message
                    : "Could not continue video capture.",
                tone: "error"
              });
            });
          }, 250);
        }
      });
  }, [isCameraReady, isCapturingVideo]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void syncPendingEvents();

        if (
          activeTripRef.current &&
          !activeTripRef.current.endedAt &&
          hasCameraAccess &&
          isCameraReady &&
          !isCapturingVideo
        ) {
          void startVideoCapture(activeTripRef.current.id).catch((error) => {
            setStatus({
              message:
                error instanceof Error
                  ? error.message
                  : "Could not resume video capture.",
              tone: "error"
            });
          });
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [
    hasCameraAccess,
    isCameraReady,
    isCapturingVideo,
    startVideoCapture,
    syncPendingEvents
  ]);

  async function enableCameraAccess() {
    try {
      await requestRecordingPermissions();
      setStatus({
        message: "Camera readying. You can start recording once preview loads.",
        tone: "idle"
      });
    } catch (error) {
      setStatus({
        message:
          error instanceof Error ? error.message : "Could not enable camera access.",
        tone: "error"
      });
    }
  }

  async function stopVideoCapture() {
    if (!recordingPromiseRef.current || !isCapturingVideo) {
      shouldContinueRecordingRef.current = false;
      return;
    }

    shouldContinueRecordingRef.current = false;
    cameraRef.current?.stopRecording();
    await recordingPromiseRef.current.catch(() => undefined);
  }

  async function startTrip() {
    setIsBusy(true);
    try {
      await requestRecordingPermissions();
      if (!cameraRef.current || !isCameraReady) {
        throw new Error("Camera is still getting ready.");
      }

      const coordinates = await getCurrentCoordinates();
      const data = await postJson<{ trip: Trip }>("/api/trips/start", coordinates);
      await persistActiveTrip(data.trip);
      await startVideoCapture(data.trip.id);
      setStatus({ message: "Trip started with camera capture.", tone: "success" });
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
      await stopVideoCapture();
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

  async function openHistory() {
    setIsHistoryOpen(true);
    setHistoryState("loading");
    setHistoryError(null);
    try {
      const response = await fetch(`${API_URL}/api/trips?limit=25`);
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      const data = (await response.json()) as { trips: TripSummary[] };
      setHistoryTrips(data.trips);
      setHistoryState("idle");
    } catch (error) {
      setHistoryState("error");
      setHistoryError(
        error instanceof Error ? error.message : "Could not load history."
      );
    }
  }

  function formatTripRange(trip: TripSummary) {
    const started = new Date(trip.startedAt);
    const startLabel = started.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
    if (!trip.endedAt) {
      return `${startLabel} — in progress`;
    }
    const durationMin = Math.max(
      1,
      Math.round(
        (new Date(trip.endedAt).getTime() - started.getTime()) / 60000
      )
    );
    return `${startLabel} — ${durationMin} min`;
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
              ? "Trip state and completed clips are preserved if the app is interrupted."
              : "Trip recording and manual road reports."}
          </Text>
        </View>

        <View style={styles.cameraPanel}>
          {hasCameraAccess ? (
            <>
              <CameraView
                facing="back"
                mode="video"
                onCameraReady={() => setIsCameraReady(true)}
                ref={cameraRef}
                style={styles.cameraPreview}
              />
              <View style={styles.zoomPillRow} pointerEvents="box-none">
                <View style={[styles.zoomPill, styles.zoomPillActive]}>
                  <Text style={[styles.zoomPillText, styles.zoomPillTextActive]}>
                    1x
                  </Text>
                </View>
              </View>
            </>
          ) : (
            <View style={styles.cameraFallback}>
              <Text style={styles.cameraFallbackTitle}>Camera access needed</Text>
              <Text style={styles.meta}>
                Civik needs camera and microphone permissions before trip footage can
                be captured.
              </Text>
              <Pressable
                onPress={enableCameraAccess}
                style={({ pressed }) => [
                  styles.permissionButton,
                  pressed && styles.buttonDisabled
                ]}
              >
                <Text style={styles.permissionButtonText}>Enable Camera</Text>
              </Pressable>
            </View>
          )}
        </View>

        <View style={styles.statusPanel}>
          <View style={styles.statusHeader}>
            <Text style={styles.label}>Status</Text>
            {isCapturingVideo ? (
              <Text style={styles.recordingPill}>Capturing</Text>
            ) : isRecording ? (
              <Text style={styles.recordingPill}>Trip Active</Text>
            ) : null}
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
          {lastClip ? (
            <Text style={styles.meta}>
              Last clip: {lastClip.status} ({lastClip.durationSeconds ?? 0}s)
            </Text>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Pressable
            disabled={isBusy || isRecording || !hasCameraAccess || !isCameraReady}
            onPress={startTrip}
            style={({ pressed }) => [
              styles.button,
              styles.primaryButton,
              (pressed ||
                isBusy ||
                isRecording ||
                !hasCameraAccess ||
                !isCameraReady) &&
                styles.buttonDisabled
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

        {hasCameraAccess && !isCameraReady ? (
          <Text style={styles.meta}>Camera is warming up.</Text>
        ) : null}

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

        <Pressable
          onPress={openHistory}
          style={({ pressed }) => [
            styles.button,
            styles.historyButton,
            pressed && styles.buttonDisabled
          ]}
        >
          <Text style={styles.historyButtonText}>View Trip History</Text>
        </Pressable>
      </ScrollView>

      <Modal
        animationType="slide"
        onRequestClose={() => setIsHistoryOpen(false)}
        presentationStyle="pageSheet"
        visible={isHistoryOpen}
      >
        <SafeAreaView style={styles.screen}>
          <View style={styles.historyHeader}>
            <Text style={styles.title}>Trip History</Text>
            <Pressable onPress={() => setIsHistoryOpen(false)}>
              <Text style={styles.historyClose}>Close</Text>
            </Pressable>
          </View>

          {historyState === "loading" ? (
            <View style={styles.loading}>
              <ActivityIndicator />
              <Text style={styles.meta}>Loading trips.</Text>
            </View>
          ) : null}

          {historyState === "error" ? (
            <View style={styles.historyPadding}>
              <Text style={[styles.statusText, styles.error]}>
                {historyError ?? "Could not load history."}
              </Text>
              <Pressable
                onPress={openHistory}
                style={({ pressed }) => [
                  styles.button,
                  styles.queueButton,
                  pressed && styles.buttonDisabled
                ]}
              >
                <Text style={styles.queueButtonText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}

          {historyState === "idle" && historyTrips.length === 0 ? (
            <View style={styles.historyPadding}>
              <Text style={styles.meta}>No trips recorded yet.</Text>
            </View>
          ) : null}

          {historyState === "idle" && historyTrips.length > 0 ? (
            <FlatList
              contentContainerStyle={styles.historyList}
              data={historyTrips}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={styles.historyCard}>
                  <Text style={styles.historyCardTitle}>
                    {formatTripRange(item)}
                  </Text>
                  <Text style={styles.meta}>
                    {item.mediaClipCount} clip
                    {item.mediaClipCount === 1 ? "" : "s"} •{" "}
                    {item.roadEventCount} event
                    {item.roadEventCount === 1 ? "" : "s"}
                    {item.endedAt ? "" : "  •  active"}
                  </Text>
                  <Text style={styles.historyCardId}>{item.id}</Text>
                </View>
              )}
            />
          ) : null}
        </SafeAreaView>
      </Modal>
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
  cameraPanel: {
    backgroundColor: "#ffffff",
    borderColor: "#dce3e8",
    borderRadius: 8,
    borderWidth: 1,
    height: 260,
    overflow: "hidden"
  },
  cameraPreview: {
    flex: 1
  },
  cameraFallback: {
    flex: 1,
    gap: 12,
    justifyContent: "center",
    padding: 16
  },
  cameraFallbackTitle: {
    color: "#172026",
    fontSize: 18,
    fontWeight: "800"
  },
  permissionButton: {
    alignItems: "center",
    backgroundColor: "#172026",
    borderRadius: 8,
    minHeight: 46,
    justifyContent: "center",
    paddingHorizontal: 16
  },
  permissionButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800"
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
  },
  zoomPillRow: {
    bottom: 12,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0
  },
  zoomPill: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    borderRadius: 999,
    height: 32,
    justifyContent: "center",
    width: 44
  },
  zoomPillActive: {
    backgroundColor: "rgba(255, 213, 0, 0.95)"
  },
  zoomPillPressed: {
    opacity: 0.75
  },
  zoomPillText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700"
  },
  zoomPillTextActive: {
    color: "#172026"
  },
  historyButton: {
    backgroundColor: "#eef2f5",
    borderColor: "#dce3e8",
    borderWidth: 1
  },
  historyButtonText: {
    color: "#172026",
    fontSize: 15,
    fontWeight: "700"
  },
  historyHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 16
  },
  historyClose: {
    color: "#2563eb",
    fontSize: 16,
    fontWeight: "700"
  },
  historyList: {
    gap: 12,
    padding: 16
  },
  historyPadding: {
    gap: 12,
    padding: 16
  },
  historyCard: {
    backgroundColor: "#ffffff",
    borderColor: "#dce3e8",
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 14
  },
  historyCardTitle: {
    color: "#172026",
    fontSize: 16,
    fontWeight: "700"
  },
  historyCardId: {
    color: "#6b7886",
    fontFamily: "Courier",
    fontSize: 11
  }
});
