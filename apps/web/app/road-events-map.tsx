"use client";

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import type { RoadEvent } from "@civik/types";

type RoadEventsMapProps = {
  roadEvents: RoadEvent[];
};

type MapCenter = [number, number];

const severityColors: Record<RoadEvent["severity"], string> = {
  low: "#157347",
  medium: "#b7791f",
  high: "#c2410c",
  critical: "#b42318"
};

function averageCenter(roadEvents: RoadEvent[]): MapCenter {
  const totals = roadEvents.reduce(
    (acc, event) => ({
      lat: acc.lat + event.lat,
      lng: acc.lng + event.lng
    }),
    { lat: 0, lng: 0 }
  );

  return [totals.lat / roadEvents.length, totals.lng / roadEvents.length];
}

function formatEventType(type: string) {
  return type.replaceAll("_", " ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function RoadEventsMap({ roadEvents }: RoadEventsMapProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const center = useMemo(() => averageCenter(roadEvents), [roadEvents]);

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) {
      return;
    }

    const map = L.map(mapElementRef.current, {
      center,
      scrollWheelZoom: true,
      zoom: 13
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [center]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    map.eachLayer((layer) => {
      if (layer instanceof L.CircleMarker) {
        layer.remove();
      }
    });

    roadEvents.forEach((event) => {
      L.circleMarker([event.lat, event.lng], {
        color: severityColors[event.severity],
        fillColor: severityColors[event.severity],
        fillOpacity: 0.75,
        radius: 9,
        weight: 2
      })
        .bindPopup(
          `<div class="map-popup">
            <strong>${formatEventType(event.type)}</strong>
            <span>Severity: ${event.severity}</span>
            <span>Reported: ${formatDate(event.createdAt)}</span>
            <span>Lat: ${event.lat.toFixed(6)}</span>
            <span>Lng: ${event.lng.toFixed(6)}</span>
          </div>`
        )
        .addTo(map);
    });

    map.setView(center, map.getZoom());
  }, [center, roadEvents]);

  return <div className="road-events-map" ref={mapElementRef} />;
}
