import AsyncStorage from "@react-native-async-storage/async-storage";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import * as FileSystem from "expo-file-system/legacy";
import { useVideoPlayer, VideoView } from "expo-video";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
const DATA_PARTNER_INTEREST_KEY = "civik.dataPartnerInterest";
const ROLLING_CLIP_SECONDS = 30;
const CLIP_DIRECTORY = `${FileSystem.documentDirectory ?? ""}civik-clips/`;
const PHOTO_DIRECTORY = `${FileSystem.documentDirectory ?? ""}civik-photos/`;
const DRIVING_REMINDERS = [
  "Stay safe out there.",
  "Eyes on the road — Civik is watching for you.",
  "Two hands on the wheel.",
  "Leave space. Trust your gut.",
  "Hydrate. Stretch if you stop.",
  "Looking out for your road family.",
  "You are the data that makes roads safer.",
  "If something feels off, tap a report.",
  "Take a break if you need one.",
  "Thanks for driving with Civik."
];
const REMINDER_INTERVAL_MS = 7000;

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

async function loadDataPartnerInterest() {
  const value = await AsyncStorage.getItem(DATA_PARTNER_INTEREST_KEY);
  return value === "true";
}

async function saveDataPartnerInterest(interested: boolean) {
  await AsyncStorage.setItem(
    DATA_PARTNER_INTEREST_KEY,
    interested ? "true" : "false"
  );
}

async function loadPendingEvents() {
  const value = await AsyncStorage.getItem(PENDING_EVENTS_STORAGE_KEY);
  return value ? (JSON.parse(value) as PendingRoadEvent[]) : [];
}

async function savePendingEvents(events: PendingRoadEvent[]) {
  await AsyncStorage.setItem(PENDING_EVENTS_STORAGE_KEY, JSON.stringify(events));
}

async function persistPhotoFile(uri: string) {
  if (!FileSystem.documentDirectory) {
    return uri;
  }
  await FileSystem.makeDirectoryAsync(PHOTO_DIRECTORY, {
    intermediates: true
  });
  const extension = uri.split(".").pop()?.split("?")[0] || "jpg";
  const destination = `${PHOTO_DIRECTORY}${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}.${extension}`;
  await FileSystem.copyAsync({ from: uri, to: destination });
  return destination;
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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Patch-a-pothole flow
  const photoCameraRef = useRef<CameraView | null>(null);
  const [isPhotoCaptureOpen, setIsPhotoCaptureOpen] = useState(false);
  const [isPhotoCameraReady, setIsPhotoCameraReady] = useState(false);
  const [photoDraftUri, setPhotoDraftUri] = useState<string | null>(null);
  const [photoNote, setPhotoNote] = useState("");
  const [isSubmittingMunicipal, setIsSubmittingMunicipal] = useState(false);
  const [dataPartnerInterest, setDataPartnerInterest] = useState(false);
  const [isCameraMode, setIsCameraMode] = useState(false);
  const [liveClock, setLiveClock] = useState(() => new Date());
  const [liveLocation, setLiveLocation] = useState<{
    lat: number;
    lng: number;
    accuracyMeters: number | null;
    speedMph: number | null;
  } | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [selectedHistoryTrip, setSelectedHistoryTrip] =
    useState<TripSummary | null>(null);
  const [tripClips, setTripClips] = useState<MediaClip[]>([]);
  const [tripClipsState, setTripClipsState] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [tripClipsError, setTripClipsError] = useState<string | null>(null);
  const [playingClip, setPlayingClip] = useState<MediaClip | null>(null);
  const [renamingClip, setRenamingClip] = useState<MediaClip | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
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

  const [reminderIndex, setReminderIndex] = useState(0);

  useEffect(() => {
    if (!isRecording) {
      setReminderIndex(0);
      return;
    }
    setReminderIndex(0);
    const handle = setInterval(() => {
      setReminderIndex((current) => (current + 1) % DRIVING_REMINDERS.length);
    }, REMINDER_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [isRecording]);

  // Live ticking clock only when camera mode is open.
  useEffect(() => {
    if (!isCameraMode) return;
    const handle = setInterval(() => setLiveClock(new Date()), 1000);
    return () => clearInterval(handle);
  }, [isCameraMode]);

  // Live GPS stream only when camera mode is open and we have permission.
  useEffect(() => {
    if (!isCameraMode) {
      setLiveLocation(null);
      return;
    }
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") {
          await Location.requestForegroundPermissionsAsync();
        }
        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 1000,
            distanceInterval: 1
          },
          (location) => {
            if (cancelled) return;
            const mps = location.coords.speed ?? 0;
            setLiveLocation({
              lat: location.coords.latitude,
              lng: location.coords.longitude,
              accuracyMeters: location.coords.accuracy ?? null,
              speedMph: mps > 0 ? mps * 2.236936 : 0
            });
          }
        );
      } catch {
        // Silently ignore — HUD just won't show GPS line.
      }
    })();
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [isCameraMode]);

  function formatElapsed(fromIso: string) {
    const totalSeconds = Math.max(
      0,
      Math.floor((Date.now() - new Date(fromIso).getTime()) / 1000)
    );
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, "0");
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

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
        const [storedTrip, storedEvents, storedInterest] = await Promise.all([
          loadActiveTrip(),
          loadPendingEvents(),
          loadDataPartnerInterest()
        ]);

        if (!isMounted) {
          return;
        }

        activeTripRef.current = storedTrip;
        setActiveTrip(storedTrip);
        setPendingEvents(storedEvents);
        setDataPartnerInterest(storedInterest);
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

    // Capture GPS at clip end so the clip is self-contained evidence.
    // Never block the metadata save on a GPS hiccup.
    const coordinates = await getCurrentCoordinates().catch(() => null);

    const data = await postJson<{ mediaClip: MediaClip }>("/api/media/clips", {
      tripId,
      localUri,
      mimeType: "video/mp4",
      durationSeconds: Math.max(1, Math.round(durationSeconds)),
      startedAt: clip.startedAt,
      endedAt: clip.endedAt,
      ...(coordinates ?? {})
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

  function openPhotoCapture() {
    setPhotoDraftUri(null);
    setPhotoNote("");
    setIsPhotoCameraReady(false);
    setIsCameraMode(false); // avoid two CameraViews competing for the back lens
    setIsPhotoCaptureOpen(true);
  }

  function closePhotoCapture() {
    setIsPhotoCaptureOpen(false);
    setPhotoDraftUri(null);
    setPhotoNote("");
  }

  async function captureMunicipalPhoto() {
    if (!photoCameraRef.current || !isPhotoCameraReady) return;
    try {
      const photo = await photoCameraRef.current.takePictureAsync({
        quality: 0.7,
        skipProcessing: false
      });
      if (!photo?.uri) {
        throw new Error("No image returned from camera.");
      }
      const persistedUri = await persistPhotoFile(photo.uri);
      setPhotoDraftUri(persistedUri);
    } catch (error) {
      Alert.alert(
        "Photo failed",
        error instanceof Error ? error.message : "Could not take photo."
      );
    }
  }

  async function submitMunicipalReport() {
    if (!photoDraftUri) return;
    setIsSubmittingMunicipal(true);
    try {
      const coordinates = await getCurrentCoordinates();
      const data = await postJson<{ roadEvent: RoadEvent }>(
        "/api/road-events",
        {
          tripId: activeTrip?.id,
          type: "pothole",
          severity: "medium",
          source: "manual",
          confidence: 1,
          note: photoNote.trim() ? photoNote.trim() : undefined,
          photoLocalUri: photoDraftUri,
          municipalStatus: "queued",
          ...coordinates
        }
      );
      setLastEvent(data.roadEvent);
      setStatus({
        message:
          "Submitted to your nearest municipality. Civik will route it once delivery partnerships are live.",
        tone: "success"
      });
      closePhotoCapture();
    } catch (error) {
      Alert.alert(
        "Submission failed",
        error instanceof Error ? error.message : "Could not submit report."
      );
    } finally {
      setIsSubmittingMunicipal(false);
    }
  }

  async function submitInTripMunicipalReport() {
    // Driver is already recording — the video clip IS the evidence, no still photo needed.
    setIsSubmittingMunicipal(true);
    try {
      const coordinates = await getCurrentCoordinates();
      const data = await postJson<{ roadEvent: RoadEvent }>(
        "/api/road-events",
        {
          tripId: activeTrip?.id,
          type: "pothole",
          severity: "medium",
          source: "manual",
          confidence: 1,
          note: "Captured during active recording — see linked trip clips.",
          municipalStatus: "queued",
          ...coordinates
        }
      );
      setLastEvent(data.roadEvent);
      setStatus({
        message:
          "Pothole submitted to nearest municipality with current trip footage as evidence.",
        tone: "success"
      });
    } catch (error) {
      Alert.alert(
        "Submission failed",
        error instanceof Error ? error.message : "Could not submit report."
      );
    } finally {
      setIsSubmittingMunicipal(false);
    }
  }

  async function retryQueuedReports() {
    setStatus({
      message: "Retrying queued reports.",
      tone: "idle"
    });
    await syncPendingEvents();
  }

  async function toggleDataPartnerInterest() {
    const next = !dataPartnerInterest;
    setDataPartnerInterest(next);
    try {
      await saveDataPartnerInterest(next);
    } catch {
      // non-fatal; UI already reflects the toggle.
    }
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

  async function openTripDetail(trip: TripSummary) {
    setSelectedHistoryTrip(trip);
    setTripClipsState("loading");
    setTripClipsError(null);
    setTripClips([]);
    try {
      const response = await fetch(
        `${API_URL}/api/trips/${trip.id}/media-clips`
      );
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      const data = (await response.json()) as { mediaClips: MediaClip[] };
      setTripClips(data.mediaClips);
      setTripClipsState("idle");
    } catch (error) {
      setTripClipsState("error");
      setTripClipsError(
        error instanceof Error ? error.message : "Could not load clips."
      );
    }
  }

  function closeTripDetail() {
    setSelectedHistoryTrip(null);
    setTripClips([]);
    setTripClipsState("idle");
    setTripClipsError(null);
  }

  async function renameClip(clip: MediaClip, nextName: string) {
    const trimmed = nextName.trim();
    if (!trimmed) return;
    try {
      const response = await fetch(`${API_URL}/api/media/clips/${clip.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed })
      });
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      const data = (await response.json()) as { mediaClip: MediaClip };
      setTripClips((prev) =>
        prev.map((existing) =>
          existing.id === clip.id ? data.mediaClip : existing
        )
      );
    } catch (error) {
      Alert.alert(
        "Rename failed",
        error instanceof Error ? error.message : "Could not rename clip."
      );
    }
  }

  function promptRenameClip(clip: MediaClip) {
    setRenamingClip(clip);
    setRenameDraft(clip.name ?? "");
  }

  async function submitRename() {
    if (!renamingClip) return;
    const target = renamingClip;
    const value = renameDraft;
    setRenamingClip(null);
    setRenameDraft("");
    await renameClip(target, value);
  }

  async function shareClip(clip: MediaClip) {
    if (!clip.localUri) {
      Alert.alert("Cannot share", "This clip is not stored on this device.");
      return;
    }
    try {
      const info = await FileSystem.getInfoAsync(clip.localUri);
      if (!info.exists) {
        Alert.alert(
          "Cannot share",
          "Clip file is missing. It may have been removed by the system."
        );
        return;
      }
      let Sharing: typeof import("expo-sharing");
      try {
        Sharing = await import("expo-sharing");
      } catch {
        Alert.alert(
          "Sharing not installed",
          "This build does not include the share module yet. Rebuild the app with EAS to enable sharing."
        );
        return;
      }
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert(
          "Sharing unavailable",
          "Sharing is not available on this device."
        );
        return;
      }
      await Sharing.shareAsync(clip.localUri, {
        dialogTitle: clip.name ?? "Civik clip",
        mimeType: "video/mp4",
        UTI: "public.movie"
      });
    } catch (error) {
      Alert.alert(
        "Share failed",
        error instanceof Error ? error.message : "Could not share clip."
      );
    }
  }

  function formatClipTime(value: string | null | undefined) {
    if (!value) {
      return "Unknown time";
    }
    return new Date(value).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
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

      <View style={styles.topBar}>
        <View style={styles.topBarBrand}>
          <Text style={styles.topBarLogo}>CIVIK</Text>
          <Text style={styles.topBarTagline}>DRIVE</Text>
        </View>
        <View style={styles.topBarActions}>
          <Pressable
            hitSlop={12}
            onPress={openHistory}
            style={({ pressed }) => [
              styles.topBarIconButton,
              pressed && styles.buttonDisabled
            ]}
          >
            <Text style={styles.topBarIconText}>History</Text>
          </Pressable>
          <Pressable
            hitSlop={12}
            onPress={() => setIsSettingsOpen(true)}
            style={({ pressed }) => [
              styles.topBarIconButton,
              styles.topBarSettingsButton,
              pressed && styles.buttonDisabled
            ]}
          >
            <Text style={styles.topBarSettingsIcon}>⚙</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.subtitle}>
            {isRecording
              ? "Trip state and completed clips are preserved if the app is interrupted."
              : "Trip recording and manual road reports."}
          </Text>
        </View>

        <View style={styles.cameraPanel}>
          {isCameraMode || isPhotoCaptureOpen ? (
            <View style={styles.cameraFallback}>
              <Text style={styles.cameraFallbackTitle}>
                {isCameraMode ? "Camera in fullscreen mode" : "Camera in use"}
              </Text>
              <Text style={styles.meta}>
                {isCameraMode
                  ? "Exit camera mode to use this preview."
                  : "Finish the photo flow to return to the preview."}
              </Text>
            </View>
          ) : hasCameraAccess ? (
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

        {isRecording ? (
          <View style={styles.reminderPanel}>
            <Text style={styles.reminderText}>
              {DRIVING_REMINDERS[reminderIndex]}
            </Text>
          </View>
        ) : null}

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

        <Pressable
          disabled={isBusy || !hasCameraAccess}
          onPress={openPhotoCapture}
          style={({ pressed }) => [
            styles.button,
            styles.patchButton,
            (pressed || isBusy || !hasCameraAccess) && styles.buttonDisabled
          ]}
        >
          <Text style={styles.patchButtonEyebrow}>📷 PATCH A POTHOLE</Text>
          <Text style={styles.patchButtonText}>
            Snap a photo and send to your nearest municipality
          </Text>
        </Pressable>

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
          disabled={!hasCameraAccess}
          onPress={() => setIsCameraMode(true)}
          style={({ pressed }) => [
            styles.button,
            styles.cameraModeButton,
            (pressed || !hasCameraAccess) && styles.buttonDisabled
          ]}
        >
          <Text style={styles.cameraModeButtonText}>ENTER CAMERA MODE</Text>
        </Pressable>

      </ScrollView>

      <Modal
        animationType="slide"
        onRequestClose={closePhotoCapture}
        presentationStyle="fullScreen"
        visible={isPhotoCaptureOpen}
      >
        <View style={styles.photoModalRoot}>
          <View style={styles.photoModalHeader}>
            <Text style={styles.photoModalTitle}>Patch a Pothole</Text>
            <Pressable hitSlop={12} onPress={closePhotoCapture}>
              <Text style={styles.photoModalClose}>Cancel</Text>
            </Pressable>
          </View>

          {!photoDraftUri ? (
            <>
              {hasCameraAccess ? (
                <CameraView
                  facing="back"
                  mode="picture"
                  onCameraReady={() => setIsPhotoCameraReady(true)}
                  ref={photoCameraRef}
                  style={styles.photoCameraView}
                />
              ) : (
                <View style={styles.historyPadding}>
                  <Text style={styles.photoModalBody}>
                    Camera access is required to take a photo.
                  </Text>
                </View>
              )}
              <View style={styles.photoModalFooter}>
                <Text style={styles.photoModalBody}>
                  Point at the pothole and tap below. We will capture your
                  current GPS at the moment you snap.
                </Text>
                <Pressable
                  disabled={!isPhotoCameraReady || isSubmittingMunicipal}
                  onPress={captureMunicipalPhoto}
                  style={({ pressed }) => [
                    styles.photoShutterButton,
                    (pressed || !isPhotoCameraReady) && styles.buttonDisabled
                  ]}
                >
                  <Text style={styles.photoShutterButtonText}>
                    ● SNAP PHOTO
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <ScrollView contentContainerStyle={styles.photoReviewContent}>
              <Image
                source={{ uri: photoDraftUri }}
                style={styles.photoReviewImage}
              />
              <Text style={styles.photoModalBody}>
                Add an optional note (which lane, how big, hazard level).
              </Text>
              <TextInput
                multiline
                maxLength={500}
                onChangeText={setPhotoNote}
                placeholder="e.g. deep pothole right lane northbound past 5th"
                placeholderTextColor="#9aa4b0"
                style={styles.photoNoteInput}
                value={photoNote}
              />
              <View style={styles.photoReviewActions}>
                <Pressable
                  disabled={isSubmittingMunicipal}
                  onPress={() => setPhotoDraftUri(null)}
                  style={({ pressed }) => [
                    styles.photoReviewSecondary,
                    pressed && styles.buttonDisabled
                  ]}
                >
                  <Text style={styles.photoReviewSecondaryText}>Retake</Text>
                </Pressable>
                <Pressable
                  disabled={isSubmittingMunicipal}
                  onPress={submitMunicipalReport}
                  style={({ pressed }) => [
                    styles.photoReviewPrimary,
                    (pressed || isSubmittingMunicipal) && styles.buttonDisabled
                  ]}
                >
                  <Text style={styles.photoReviewPrimaryText}>
                    {isSubmittingMunicipal ? "Submitting…" : "Send to City"}
                  </Text>
                </Pressable>
              </View>
              <Text style={styles.photoModalSmallPrint}>
                Civik queues this report for routing to your nearest municipality.
                Per-jurisdiction delivery (311, SeeClickFix, etc.) is wired
                separately — your photo, location, and note are saved either way.
              </Text>
            </ScrollView>
          )}
        </View>
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={() => setIsSettingsOpen(false)}
        presentationStyle="pageSheet"
        visible={isSettingsOpen}
      >
        <SafeAreaView style={styles.screen}>
          <View style={styles.historyHeader}>
            <Text style={styles.title}>Settings</Text>
            <Pressable onPress={() => setIsSettingsOpen(false)}>
              <Text style={styles.historyClose}>Close</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.settingsContent}>
            {/* Lead feature: Data Partner Program */}
            <View style={styles.settingsCardHero}>
              <Text style={styles.settingsHeroEyebrow}>
                CIVIK DATA PARTNER PROGRAM
              </Text>
              <Text style={styles.settingsHeroTitle}>
                Earn from your footage.
              </Text>
              <Text style={styles.settingsHeroBody}>
                AI companies pay for high-quality, real-world driving data —
                labeled clips with GPS, time, and road context. Civik turns your
                trips into a passive income stream by aggregating consented
                footage and selling it to model trainers, mapping companies, and
                infrastructure analysts. You get a share of every sale tied to
                your data.
              </Text>

              <View style={styles.settingsDivider} />

              <Text style={styles.settingsSectionLabel}>
                CONNECT NVIDIA JETSON ORIN
              </Text>
              <Text style={styles.settingsBody}>
                Plug an NVIDIA Jetson Orin Nano dev kit into your vehicle and
                Civik will run inference on your footage at the edge — detecting
                potholes, debris, lane damage, and near-miss events as they
                happen. Pre-labeled data is worth more, so connected drivers
                earn more per upload.
              </Text>
              <Pressable
                onPress={() =>
                  Alert.alert(
                    "Coming soon",
                    "Edge inference and Jetson Orin pairing is in development. Toggle 'Notify me when ready' below to get early access."
                  )
                }
                style={({ pressed }) => [
                  styles.settingsCtaButton,
                  pressed && styles.buttonDisabled
                ]}
              >
                <Text style={styles.settingsCtaButtonText}>
                  Connect a Jetson Orin (coming soon)
                </Text>
              </Pressable>

              <View style={styles.settingsDivider} />

              <Pressable
                onPress={toggleDataPartnerInterest}
                style={({ pressed }) => [
                  styles.settingsToggleRow,
                  pressed && styles.buttonDisabled
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.settingsToggleTitle}>
                    Notify me when ready
                  </Text>
                  <Text style={styles.settingsBody}>
                    We will let you know when the data partner program and
                    Jetson pairing go live.
                  </Text>
                </View>
                <View
                  style={[
                    styles.settingsToggleSwitch,
                    dataPartnerInterest && styles.settingsToggleSwitchOn
                  ]}
                >
                  <View
                    style={[
                      styles.settingsToggleKnob,
                      dataPartnerInterest && styles.settingsToggleKnobOn
                    ]}
                  />
                </View>
              </Pressable>
            </View>

            {/* Account placeholder */}
            <View style={styles.settingsCard}>
              <Text style={styles.settingsSectionLabel}>ACCOUNT</Text>
              <Text style={styles.settingsBody}>
                Auth is not wired yet — every trip belongs to "dev_user" right
                now. Real accounts, devices, and payouts come with the data
                partner launch.
              </Text>
            </View>

            {/* Storage placeholder */}
            <View style={styles.settingsCard}>
              <Text style={styles.settingsSectionLabel}>STORAGE</Text>
              <Text style={styles.settingsBody}>
                Clips are stored locally on this device until cloud upload is
                wired. Retention controls (keep last N days / X GB) will live
                here.
              </Text>
            </View>

            {/* About */}
            <View style={styles.settingsCard}>
              <Text style={styles.settingsSectionLabel}>ABOUT</Text>
              <Text style={styles.settingsBody}>
                Civik turns your driving phone into a road-intelligence
                sensor — for you, your fleet, your city, and the road
                community.
              </Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

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
                <Pressable
                  onPress={() => openTripDetail(item)}
                  style={({ pressed }) => [
                    styles.historyCard,
                    pressed && styles.buttonDisabled
                  ]}
                >
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
                </Pressable>
              )}
            />
          ) : null}
        </SafeAreaView>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setIsCameraMode(false)}
        presentationStyle="fullScreen"
        visible={isCameraMode}
      >
        <View style={styles.cameraModeRoot}>
          <StatusBar style="light" />
          {hasCameraAccess ? (
            <CameraView
              facing="back"
              mode="video"
              onCameraReady={() => setIsCameraReady(true)}
              ref={cameraRef}
              style={styles.cameraModeView}
            />
          ) : null}

          {/* Top-left: REC indicator + elapsed */}
          <View style={[styles.hudCorner, styles.hudTopLeft]}>
            {isCapturingVideo ? (
              <View style={styles.recRow}>
                <View style={styles.recDot} />
                <Text style={styles.hudBigText}>REC</Text>
              </View>
            ) : null}
            {activeTrip ? (
              <Text style={styles.hudText}>
                {formatElapsed(activeTrip.startedAt)} trip
              </Text>
            ) : null}
          </View>

          {/* Top-right: clock + close */}
          <View style={[styles.hudCorner, styles.hudTopRight]}>
            <Pressable
              hitSlop={16}
              onPress={() => setIsCameraMode(false)}
              style={styles.hudCloseButton}
            >
              <Text style={styles.hudCloseText}>EXIT</Text>
            </Pressable>
            <Text style={styles.hudBigText}>
              {liveClock.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false
              })}
            </Text>
            <Text style={styles.hudText}>
              {liveClock.toLocaleDateString([], {
                month: "short",
                day: "numeric",
                year: "numeric"
              })}
            </Text>
          </View>

          {/* Cycling reminder */}
          {isRecording ? (
            <View style={styles.hudReminderRow}>
              <Text style={styles.hudReminder}>
                {DRIVING_REMINDERS[reminderIndex]}
              </Text>
            </View>
          ) : null}

          {/* Bottom-left: GPS */}
          <View style={[styles.hudCorner, styles.hudBottomLeft]}>
            {liveLocation ? (
              <>
                <Text style={styles.hudText}>
                  📍 {liveLocation.lat.toFixed(5)},{" "}
                  {liveLocation.lng.toFixed(5)}
                </Text>
                {liveLocation.accuracyMeters != null ? (
                  <Text style={styles.hudSmallText}>
                    ±{Math.round(liveLocation.accuracyMeters)}m
                  </Text>
                ) : null}
              </>
            ) : (
              <Text style={styles.hudSmallText}>GPS searching…</Text>
            )}
          </View>

          {/* Bottom-right: speed */}
          <View style={[styles.hudCorner, styles.hudBottomRight]}>
            <Text style={styles.hudBigText}>
              {liveLocation?.speedMph != null
                ? Math.round(liveLocation.speedMph)
                : "--"}
            </Text>
            <Text style={styles.hudSmallText}>MPH</Text>
          </View>

          {/* Bottom action bar */}
          <View style={styles.hudActionBar}>
            <View style={styles.hudReportRow}>
              <Pressable
                disabled={isBusy}
                onPress={() => reportEvent("pothole")}
                style={({ pressed }) => [
                  styles.hudReportPill,
                  (pressed || isBusy) && styles.buttonDisabled
                ]}
              >
                <Text style={styles.hudReportPillText}>Pothole</Text>
              </Pressable>
              <Pressable
                disabled={isBusy}
                onPress={() => reportEvent("debris")}
                style={({ pressed }) => [
                  styles.hudReportPill,
                  (pressed || isBusy) && styles.buttonDisabled
                ]}
              >
                <Text style={styles.hudReportPillText}>Debris</Text>
              </Pressable>
              <Pressable
                disabled={isBusy}
                onPress={() => reportEvent("crash")}
                style={({ pressed }) => [
                  styles.hudReportPill,
                  styles.hudReportPillDanger,
                  (pressed || isBusy) && styles.buttonDisabled
                ]}
              >
                <Text style={styles.hudReportPillDangerText}>Crash</Text>
              </Pressable>
            </View>
            <Pressable
              disabled={isBusy || isSubmittingMunicipal}
              onPress={isRecording ? submitInTripMunicipalReport : openPhotoCapture}
              style={({ pressed }) => [
                styles.hudCityButton,
                (pressed || isBusy || isSubmittingMunicipal) &&
                  styles.buttonDisabled
              ]}
            >
              <Text style={styles.hudCityButtonText}>
                {isSubmittingMunicipal
                  ? "Submitting…"
                  : isRecording
                    ? "📷 Send Pothole to City (uses trip footage)"
                    : "📷 Snap Pothole & Send to City"}
              </Text>
            </Pressable>
            {isRecording ? (
              <Pressable
                disabled={isBusy}
                onPress={stopTrip}
                style={({ pressed }) => [
                  styles.hudPrimaryButton,
                  styles.hudPrimaryButtonStop,
                  (pressed || isBusy) && styles.buttonDisabled
                ]}
              >
                <Text style={styles.hudPrimaryButtonStopText}>STOP TRIP</Text>
              </Pressable>
            ) : (
              <Pressable
                disabled={isBusy || !isCameraReady}
                onPress={startTrip}
                style={({ pressed }) => [
                  styles.hudPrimaryButton,
                  (pressed || isBusy || !isCameraReady) &&
                    styles.buttonDisabled
                ]}
              >
                <Text style={styles.hudPrimaryButtonText}>● RECORD</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={closeTripDetail}
        presentationStyle="pageSheet"
        visible={selectedHistoryTrip !== null}
      >
        <SafeAreaView style={styles.screen}>
          <View style={styles.historyHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Trip</Text>
              {selectedHistoryTrip ? (
                <Text style={styles.meta}>
                  {formatTripRange(selectedHistoryTrip)}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={closeTripDetail}>
              <Text style={styles.historyClose}>Close</Text>
            </Pressable>
          </View>

          {tripClipsState === "loading" ? (
            <View style={styles.loading}>
              <ActivityIndicator />
              <Text style={styles.meta}>Loading clips.</Text>
            </View>
          ) : null}

          {tripClipsState === "error" ? (
            <View style={styles.historyPadding}>
              <Text style={[styles.statusText, styles.error]}>
                {tripClipsError ?? "Could not load clips."}
              </Text>
            </View>
          ) : null}

          {tripClipsState === "idle" && tripClips.length === 0 ? (
            <View style={styles.historyPadding}>
              <Text style={styles.meta}>No clips recorded for this trip.</Text>
            </View>
          ) : null}

          {tripClipsState === "idle" && tripClips.length > 0 ? (
            <FlatList
              contentContainerStyle={styles.historyList}
              data={tripClips}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => {
                const hasPlayableUri = Boolean(item.localUri);
                const displayName =
                  item.name ??
                  formatClipTime(item.startedAt ?? item.createdAt);
                return (
                  <View style={styles.clipCard}>
                    <Pressable
                      disabled={!hasPlayableUri}
                      onPress={() => setPlayingClip(item)}
                      style={({ pressed }) => [
                        styles.clipCardBody,
                        pressed && styles.buttonDisabled,
                        !hasPlayableUri && styles.clipCardDisabled
                      ]}
                    >
                      <Text style={styles.clipCardTitle}>{displayName}</Text>
                      {item.name ? (
                        <Text style={styles.meta}>
                          {formatClipTime(item.startedAt ?? item.createdAt)}
                        </Text>
                      ) : null}
                      <Text style={styles.meta}>
                        {Math.round(item.durationSeconds ?? 0)}s • {item.status}
                      </Text>
                      {item.lat != null && item.lng != null ? (
                        <Text style={styles.meta}>
                          📍 {item.lat.toFixed(5)}, {item.lng.toFixed(5)}
                        </Text>
                      ) : null}
                      <Text style={styles.clipCardCta}>
                        {hasPlayableUri
                          ? "Tap to play"
                          : "Not stored on this device"}
                      </Text>
                    </Pressable>
                    <View style={styles.clipCardActions}>
                      <Pressable
                        onPress={() => promptRenameClip(item)}
                        style={({ pressed }) => [
                          styles.clipActionButton,
                          pressed && styles.buttonDisabled
                        ]}
                      >
                        <Text style={styles.clipActionText}>Rename</Text>
                      </Pressable>
                      <Pressable
                        disabled={!hasPlayableUri}
                        onPress={() => shareClip(item)}
                        style={({ pressed }) => [
                          styles.clipActionButton,
                          styles.clipShareButton,
                          (pressed || !hasPlayableUri) && styles.buttonDisabled
                        ]}
                      >
                        <Text style={styles.clipShareText}>Share</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              }}
            />
          ) : null}
        </SafeAreaView>
      </Modal>

      {playingClip ? (
        <ClipPlayerModal
          key={playingClip.id}
          clip={playingClip}
          onClose={() => setPlayingClip(null)}
        />
      ) : null}

      <Modal
        animationType="fade"
        onRequestClose={() => setRenamingClip(null)}
        transparent
        visible={renamingClip !== null}
      >
        <View style={styles.renameBackdrop}>
          <View style={styles.renameCard}>
            <Text style={styles.renameTitle}>Rename clip</Text>
            <Text style={styles.meta}>
              Give this recording a name you will recognize later.
            </Text>
            <TextInput
              autoFocus
              maxLength={120}
              onChangeText={setRenameDraft}
              placeholder="e.g. pothole near Main and 5th"
              style={styles.renameInput}
              value={renameDraft}
            />
            <View style={styles.renameActions}>
              <Pressable
                onPress={() => setRenamingClip(null)}
                style={({ pressed }) => [
                  styles.renameButton,
                  pressed && styles.buttonDisabled
                ]}
              >
                <Text style={styles.renameButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={renameDraft.trim().length === 0}
                onPress={submitRename}
                style={({ pressed }) => [
                  styles.renameButton,
                  styles.renameButtonPrimary,
                  (pressed || renameDraft.trim().length === 0) &&
                    styles.buttonDisabled
                ]}
              >
                <Text style={styles.renameButtonPrimaryText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ClipPlayerModal({
  clip,
  onClose
}: {
  clip: MediaClip;
  onClose: () => void;
}) {
  const [fileError, setFileError] = useState<string | null>(null);
  const [isFileChecked, setIsFileChecked] = useState(false);
  const [resolvedUri, setResolvedUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function verify() {
      if (!clip.localUri) {
        setFileError("This clip is not stored on this device.");
        setIsFileChecked(true);
        return;
      }
      try {
        const info = await FileSystem.getInfoAsync(clip.localUri);
        if (cancelled) return;
        if (!info.exists) {
          setFileError(
            `Clip file not found at ${clip.localUri}. The app may have been reinstalled since it was recorded.`
          );
        } else {
          setResolvedUri(clip.localUri);
        }
      } catch (error) {
        if (cancelled) return;
        setFileError(
          error instanceof Error ? error.message : "Could not read clip file."
        );
      } finally {
        if (!cancelled) {
          setIsFileChecked(true);
        }
      }
    }
    void verify();
    return () => {
      cancelled = true;
    };
  }, [clip.localUri]);

  const player = useVideoPlayer(resolvedUri, (instance) => {
    instance.loop = false;
    if (resolvedUri) {
      instance.play();
    }
  });

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      visible
    >
      <SafeAreaView style={styles.playerScreen}>
        <View style={styles.playerHeader}>
          <Pressable onPress={onClose}>
            <Text style={styles.playerClose}>Done</Text>
          </Pressable>
        </View>
        {!isFileChecked ? (
          <View style={styles.loading}>
            <ActivityIndicator color="#ffffff" />
            <Text style={styles.playerClose}>Loading clip.</Text>
          </View>
        ) : resolvedUri ? (
          <VideoView
            contentFit="contain"
            player={player}
            style={styles.playerVideo}
          />
        ) : (
          <View style={styles.historyPadding}>
            <Text style={styles.playerClose}>{fileError}</Text>
          </View>
        )}
      </SafeAreaView>
    </Modal>
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
  reminderPanel: {
    backgroundColor: "#172026",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  reminderText: {
    color: "#ffd500",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center"
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
  },
  clipCard: {
    backgroundColor: "#ffffff",
    borderColor: "#dce3e8",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden"
  },
  clipCardBody: {
    gap: 6,
    padding: 14
  },
  clipCardActions: {
    borderTopColor: "#eef2f5",
    borderTopWidth: 1,
    flexDirection: "row"
  },
  clipActionButton: {
    alignItems: "center",
    flex: 1,
    paddingVertical: 12
  },
  clipActionText: {
    color: "#172026",
    fontSize: 14,
    fontWeight: "700"
  },
  clipShareButton: {
    backgroundColor: "#172026"
  },
  clipShareText: {
    color: "#ffd500",
    fontSize: 14,
    fontWeight: "800"
  },
  clipCardDisabled: {
    opacity: 0.55
  },
  clipCardTitle: {
    color: "#172026",
    fontSize: 15,
    fontWeight: "700"
  },
  clipCardCta: {
    color: "#2563eb",
    fontSize: 13,
    fontWeight: "700"
  },
  playerScreen: {
    backgroundColor: "#000000",
    flex: 1
  },
  playerHeader: {
    alignItems: "flex-end",
    padding: 16
  },
  playerClose: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700"
  },
  playerVideo: {
    backgroundColor: "#000000",
    flex: 1
  },
  renameBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    flex: 1,
    justifyContent: "center",
    padding: 24
  },
  renameCard: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    gap: 12,
    padding: 20,
    width: "100%"
  },
  renameTitle: {
    color: "#172026",
    fontSize: 18,
    fontWeight: "800"
  },
  renameInput: {
    borderColor: "#dce3e8",
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  renameActions: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end"
  },
  renameButton: {
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  renameButtonText: {
    color: "#172026",
    fontSize: 15,
    fontWeight: "700"
  },
  renameButtonPrimary: {
    backgroundColor: "#172026"
  },
  renameButtonPrimaryText: {
    color: "#ffd500",
    fontSize: 15,
    fontWeight: "800"
  },
  cameraModeButton: {
    backgroundColor: "#000000",
    borderWidth: 0
  },
  cameraModeButtonText: {
    color: "#ffd500",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 1.5
  },
  cameraModeRoot: {
    backgroundColor: "#000000",
    flex: 1
  },
  cameraModeView: {
    height: "100%",
    left: 0,
    position: "absolute",
    top: 0,
    width: "100%"
  },
  hudCorner: {
    position: "absolute",
    padding: 14,
    gap: 2
  },
  hudTopLeft: { top: 44, left: 12, alignItems: "flex-start" },
  hudTopRight: { top: 44, right: 12, alignItems: "flex-end" },
  hudBottomLeft: { bottom: 168, left: 12, alignItems: "flex-start" },
  hudBottomRight: { bottom: 168, right: 12, alignItems: "flex-end" },
  hudText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3
  },
  hudSmallText: {
    color: "#cfd6dd",
    fontSize: 11,
    fontWeight: "600",
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3
  },
  hudBigText: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 0.5,
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4
  },
  recRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6
  },
  recDot: {
    backgroundColor: "#ff2d2d",
    borderRadius: 6,
    height: 12,
    width: 12
  },
  hudCloseButton: {
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 999,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  hudCloseText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1
  },
  hudReminderRow: {
    alignItems: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 130
  },
  hudReminder: {
    backgroundColor: "rgba(23,32,38,0.85)",
    borderRadius: 999,
    color: "#ffd500",
    fontSize: 14,
    fontWeight: "800",
    paddingHorizontal: 14,
    paddingVertical: 8,
    textAlign: "center"
  },
  hudActionBar: {
    bottom: 24,
    gap: 12,
    left: 16,
    position: "absolute",
    right: 16
  },
  hudReportRow: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "center"
  },
  hudReportPill: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  hudReportPillText: {
    color: "#172026",
    fontSize: 13,
    fontWeight: "800"
  },
  hudReportPillDanger: {
    backgroundColor: "#b91c1c"
  },
  hudReportPillDangerText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800"
  },
  hudPrimaryButton: {
    alignItems: "center",
    backgroundColor: "#ffd500",
    borderRadius: 14,
    minHeight: 60,
    justifyContent: "center"
  },
  hudPrimaryButtonText: {
    color: "#172026",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 2
  },
  hudPrimaryButtonStop: {
    backgroundColor: "#b91c1c"
  },
  hudPrimaryButtonStopText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 2
  },
  topBar: {
    alignItems: "center",
    backgroundColor: "#172026",
    borderBottomColor: "#0b1015",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  topBarBrand: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: 6
  },
  topBarLogo: {
    color: "#ffd500",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 2
  },
  topBarTagline: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2
  },
  topBarActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  topBarIconButton: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  topBarIconText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1
  },
  topBarSettingsButton: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    paddingHorizontal: 0,
    width: 32
  },
  topBarSettingsIcon: {
    color: "#ffd500",
    fontSize: 18
  },
  settingsContent: {
    gap: 14,
    padding: 16,
    paddingBottom: 40
  },
  settingsCardHero: {
    backgroundColor: "#172026",
    borderRadius: 14,
    gap: 10,
    padding: 18
  },
  settingsCard: {
    backgroundColor: "#ffffff",
    borderColor: "#dce3e8",
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    padding: 16
  },
  settingsHeroEyebrow: {
    color: "#ffd500",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2
  },
  settingsHeroTitle: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "900"
  },
  settingsHeroBody: {
    color: "#cfd6dd",
    fontSize: 14,
    lineHeight: 20
  },
  settingsDivider: {
    backgroundColor: "rgba(255,255,255,0.1)",
    height: 1,
    marginVertical: 4
  },
  settingsSectionLabel: {
    color: "#172026",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2
  },
  settingsBody: {
    color: "#6b7886",
    fontSize: 13,
    lineHeight: 18
  },
  settingsCtaButton: {
    alignItems: "center",
    backgroundColor: "#ffd500",
    borderRadius: 10,
    paddingVertical: 12
  },
  settingsCtaButtonText: {
    color: "#172026",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1
  },
  settingsToggleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12
  },
  settingsToggleTitle: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800"
  },
  settingsToggleSwitch: {
    backgroundColor: "rgba(255,255,255,0.16)",
    borderRadius: 999,
    height: 28,
    justifyContent: "center",
    padding: 2,
    width: 50
  },
  settingsToggleSwitchOn: {
    backgroundColor: "#ffd500"
  },
  settingsToggleKnob: {
    backgroundColor: "#ffffff",
    borderRadius: 999,
    height: 24,
    width: 24
  },
  settingsToggleKnobOn: {
    backgroundColor: "#172026",
    marginLeft: 22
  },
  patchButton: {
    alignItems: "center",
    backgroundColor: "#ffd500",
    gap: 4
  },
  patchButtonEyebrow: {
    color: "#172026",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2
  },
  patchButtonText: {
    color: "#172026",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center"
  },
  hudCityButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,213,0,0.95)",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  hudCityButtonText: {
    color: "#172026",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.5
  },
  photoModalRoot: {
    backgroundColor: "#0b1015",
    flex: 1
  },
  photoModalHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12
  },
  photoModalTitle: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "900"
  },
  photoModalClose: {
    color: "#ffd500",
    fontSize: 15,
    fontWeight: "800"
  },
  photoCameraView: {
    flex: 1
  },
  photoModalFooter: {
    backgroundColor: "rgba(0,0,0,0.4)",
    gap: 12,
    padding: 16
  },
  photoModalBody: {
    color: "#cfd6dd",
    fontSize: 13,
    lineHeight: 18
  },
  photoShutterButton: {
    alignItems: "center",
    backgroundColor: "#ffd500",
    borderRadius: 14,
    minHeight: 60,
    justifyContent: "center"
  },
  photoShutterButtonText: {
    color: "#172026",
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 2
  },
  photoReviewContent: {
    gap: 14,
    padding: 16,
    paddingBottom: 40
  },
  photoReviewImage: {
    aspectRatio: 3 / 4,
    backgroundColor: "#000000",
    borderRadius: 12,
    width: "100%"
  },
  photoNoteInput: {
    backgroundColor: "#172026",
    borderRadius: 10,
    color: "#ffffff",
    fontSize: 15,
    minHeight: 100,
    padding: 12,
    textAlignVertical: "top"
  },
  photoReviewActions: {
    flexDirection: "row",
    gap: 10
  },
  photoReviewSecondary: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 12,
    flex: 1,
    paddingVertical: 14
  },
  photoReviewSecondaryText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800"
  },
  photoReviewPrimary: {
    alignItems: "center",
    backgroundColor: "#ffd500",
    borderRadius: 12,
    flex: 2,
    paddingVertical: 14
  },
  photoReviewPrimaryText: {
    color: "#172026",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 1
  },
  photoModalSmallPrint: {
    color: "#9aa4b0",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4
  }
});
