"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { RoadEvent } from "@civik/types";

const RoadEventsMap = dynamic(
  () => import("./road-events-map").then((module) => module.RoadEventsMap),
  {
    ssr: false,
    loading: () => <div className="map-loading">Loading map...</div>
  }
);

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

type RoadEventsState =
  | { status: "loading"; roadEvents: RoadEvent[]; error?: undefined }
  | { status: "success"; roadEvents: RoadEvent[]; error?: undefined }
  | { status: "error"; roadEvents: RoadEvent[]; error: string };

function formatEventType(type: string) {
  return type.replaceAll("_", " ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function RoadEventsDashboard() {
  const [state, setState] = useState<RoadEventsState>({
    status: "loading",
    roadEvents: []
  });

  useEffect(() => {
    let isMounted = true;

    async function loadRoadEvents() {
      try {
        const response = await fetch(`${API_URL}/api/road-events`, {
          cache: "no-store"
        });

        if (!response.ok) {
          throw new Error(`API returned ${response.status}`);
        }

        const data = (await response.json()) as { roadEvents: RoadEvent[] };

        if (isMounted) {
          setState({ status: "success", roadEvents: data.roadEvents });
        }
      } catch (error) {
        if (isMounted) {
          setState({
            status: "error",
            roadEvents: [],
            error:
              error instanceof Error ? error.message : "Could not fetch events."
          });
        }
      }
    }

    void loadRoadEvents();

    return () => {
      isMounted = false;
    };
  }, []);

  const { roadEvents } = state;

  return (
    <main>
      <div className="page-shell">
        <header className="header">
          <div>
            <p className="eyebrow">Civik Road Intelligence</p>
            <h1>Road events</h1>
            <p className="subtitle">
              Manual reports from driver trips shown on a live OpenStreetMap
              view and table.
            </p>
          </div>
          <div className="header-aside">
            <div className="stat">
              <span className="stat-value">{roadEvents.length}</span>
              <span className="stat-label">reported events</span>
            </div>
            <Link href="/municipal" className="btn btn-primary header-cta">
              Open municipal queue →
            </Link>
          </div>
        </header>

        {state.status === "loading" ? (
          <div className="loading-panel">Loading road events...</div>
        ) : null}

        {state.status === "error" ? (
          <div className="error">API unavailable: {state.error}</div>
        ) : null}

        {state.status === "success" && roadEvents.length === 0 ? (
          <div className="empty">No road events have been reported yet.</div>
        ) : null}

        {roadEvents.length > 0 ? (
          <>
            <section className="map-section" aria-label="Road events map">
              <RoadEventsMap roadEvents={roadEvents} />
            </section>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Severity</th>
                    <th>Source</th>
                    <th>Confidence</th>
                    <th>Coordinates</th>
                    <th>Trip</th>
                    <th>Reported</th>
                  </tr>
                </thead>
                <tbody>
                  {roadEvents.map((event) => (
                    <tr key={event.id}>
                      <td className="type">{formatEventType(event.type)}</td>
                      <td>{event.severity}</td>
                      <td>{event.source}</td>
                      <td>{Math.round(event.confidence * 100)}%</td>
                      <td>
                        {event.lat.toFixed(5)}, {event.lng.toFixed(5)}
                        {event.accuracyMeters ? (
                          <div className="muted">
                            accuracy {Math.round(event.accuracyMeters)}m
                          </div>
                        ) : null}
                      </td>
                      <td className="muted">{event.tripId ?? "No trip"}</td>
                      <td>{formatDate(event.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
