import { useMemo, useState } from "react";
import {
  ActivityIndicator,
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

type ApiStatus = {
  message: string;
  tone: "idle" | "success" | "error";
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

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": makeIdempotencyKey(path)
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`API request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export default function App() {
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [lastEvent, setLastEvent] = useState<RoadEvent | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState<ApiStatus>({
    message: "Ready to record.",
    tone: "idle"
  });

  const isRecording = useMemo(
    () => Boolean(activeTrip && !activeTrip.endedAt),
    [activeTrip]
  );

  async function startTrip() {
    setIsBusy(true);
    try {
      const coordinates = await getCurrentCoordinates();
      const data = await postJson<{ trip: Trip }>("/api/trips/start", coordinates);
      setActiveTrip(data.trip);
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
      setActiveTrip(data.trip);
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
    try {
      const coordinates = await getCurrentCoordinates();
      const data = await postJson<{ roadEvent: RoadEvent }>("/api/road-events", {
        tripId: activeTrip?.id,
        type,
        severity: type === "crash" ? "high" : "medium",
        source: "manual",
        confidence: 1,
        ...coordinates
      });

      setLastEvent(data.roadEvent);
      setStatus({ message: `${type.replace("_", " ")} reported.`, tone: "success" });
    } catch (error) {
      setStatus({
        message:
          error instanceof Error ? error.message : "Could not report road event.",
        tone: "error"
      });
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Civik Drive</Text>
          <Text style={styles.subtitle}>Trip recording and manual road reports.</Text>
        </View>

        <View style={styles.statusPanel}>
          <Text style={styles.label}>Status</Text>
          <Text style={[styles.statusText, styles[status.tone]]}>
            {status.message}
          </Text>
          {activeTrip ? (
            <Text style={styles.meta}>Trip ID: {activeTrip.id}</Text>
          ) : (
            <Text style={styles.meta}>No active trip.</Text>
          )}
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

        {isBusy ? (
          <View style={styles.loading}>
            <ActivityIndicator />
            <Text style={styles.meta}>Working with location and API.</Text>
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
  label: {
    color: "#6a7780",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase"
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
