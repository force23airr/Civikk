"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MediaClip, MunicipalReportStatus, RoadEvent } from "@civik/types";

const RoadEventsMap = dynamic(
  () => import("../road-events-map").then((module) => module.RoadEventsMap),
  {
    ssr: false,
    loading: () => <div className="map-loading">Loading map...</div>
  }
);

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

type SectionId =
  | "live"
  | "data-collection"
  | "data-analysis"
  | "insights"
  | "tasks"
  | "drivers"
  | "users"
  | "cars"
  | "goals"
  | "other-visions";

const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: "live", label: "Live", icon: "●" },
  { id: "data-collection", label: "Data collection", icon: "▤" },
  { id: "data-analysis", label: "Data analysis", icon: "◫" },
  { id: "insights", label: "Insights", icon: "✦" },
  { id: "tasks", label: "Tasks", icon: "✓" },
  { id: "drivers", label: "Drivers", icon: "⌖" },
  { id: "users", label: "Users", icon: "◍" },
  { id: "cars", label: "Cars", icon: "▣" },
  { id: "goals", label: "Goals", icon: "◎" },
  { id: "other-visions", label: "Other visions", icon: "✧" }
];

const STATUS_TABS: { id: MunicipalReportStatus; label: string }[] = [
  { id: "queued", label: "Queued" },
  { id: "acknowledged", label: "Acknowledged" },
  { id: "resolved", label: "Resolved" }
];

const STATUS_LABEL: Record<MunicipalReportStatus, string> = {
  not_submitted: "Not submitted",
  queued: "Queued",
  submitted: "Submitted",
  acknowledged: "Acknowledged",
  resolved: "Resolved"
};

function formatEventType(type: string) {
  return type.replaceAll("_", " ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatTimeAgo(value: string) {
  const ms = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function osmLink(lat: number, lng: number) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
}

const SEVERITY_ORDINAL: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

function pearson(xs: number[], ys: number[]): number | null {
  const pairs: [number, number][] = [];
  for (let i = 0; i < xs.length; i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
      pairs.push([xs[i], ys[i]]);
    }
  }
  if (pairs.length < 3) return null;
  const n = pairs.length;
  const xMean = pairs.reduce((s, [x]) => s + x, 0) / n;
  const yMean = pairs.reduce((s, [, y]) => s + y, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const [x, y] of pairs) {
    const a = x - xMean;
    const b = y - yMean;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const denom = Math.sqrt(dx * dy);
  if (denom === 0) return null;
  return num / denom;
}

function meanStd(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "—";
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function maskId(id: string): string {
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

type LoadState =
  | { status: "loading" }
  | { status: "success" }
  | { status: "error"; error: string };

export function MunicipalDashboard() {
  const [activeSection, setActiveSection] = useState<SectionId>("live");
  const [activeTab, setActiveTab] = useState<MunicipalReportStatus>("queued");
  const [roadEvents, setRoadEvents] = useState<RoadEvent[]>([]);
  const [allEvents, setAllEvents] = useState<RoadEvent[]>([]);
  const [mediaClips, setMediaClips] = useState<MediaClip[]>([]);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<number>(Date.now());
  const [counts, setCounts] = useState<Record<MunicipalReportStatus, number>>({
    not_submitted: 0,
    queued: 0,
    submitted: 0,
    acknowledged: 0,
    resolved: 0
  });

  const fetchEvents = useCallback(async (status: MunicipalReportStatus) => {
    setLoadState({ status: "loading" });
    try {
      const response = await fetch(
        `${API_URL}/api/road-events?municipalStatus=${status}&limit=200`,
        { cache: "no-store" }
      );
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      const data = (await response.json()) as { roadEvents: RoadEvent[] };
      setRoadEvents(data.roadEvents);
      setLoadState({ status: "success" });
      setLastRefreshed(Date.now());
    } catch (error) {
      setRoadEvents([]);
      setLoadState({
        status: "error",
        error: error instanceof Error ? error.message : "Could not fetch events."
      });
    }
  }, []);

  const fetchAllEvents = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/road-events?limit=500`, {
        cache: "no-store"
      });
      if (!response.ok) return;
      const data = (await response.json()) as { roadEvents: RoadEvent[] };
      setAllEvents(data.roadEvents);
      setLastRefreshed(Date.now());
    } catch {
      // Best-effort.
    }
  }, []);

  const fetchMediaClips = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/media/clips?limit=200`, {
        cache: "no-store"
      });
      if (!response.ok) return;
      const data = (await response.json()) as { mediaClips: MediaClip[] };
      setMediaClips(data.mediaClips);
    } catch {
      // Best-effort.
    }
  }, []);

  const refreshCounts = useCallback(async () => {
    try {
      const results = await Promise.all(
        STATUS_TABS.map(async (tab) => {
          const response = await fetch(
            `${API_URL}/api/road-events?municipalStatus=${tab.id}&limit=500`,
            { cache: "no-store" }
          );
          if (!response.ok) return [tab.id, 0] as const;
          const data = (await response.json()) as { roadEvents: RoadEvent[] };
          return [tab.id, data.roadEvents.length] as const;
        })
      );
      setCounts((prev) => {
        const next = { ...prev };
        for (const [id, count] of results) {
          next[id] = count;
        }
        return next;
      });
    } catch {
      // Counts are best-effort.
    }
  }, []);

  useEffect(() => {
    if (activeSection === "live" || activeSection === "tasks") {
      void fetchEvents(activeTab);
    }
  }, [activeSection, activeTab, fetchEvents]);

  useEffect(() => {
    void refreshCounts();
    void fetchAllEvents();
    void fetchMediaClips();
  }, [refreshCounts, fetchAllEvents, fetchMediaClips]);

  const updateStatus = useCallback(
    async (eventId: string, nextStatus: MunicipalReportStatus) => {
      setPendingId(eventId);
      try {
        const response = await fetch(`${API_URL}/api/road-events/${eventId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ municipalStatus: nextStatus })
        });
        if (!response.ok) {
          throw new Error(`API returned ${response.status}`);
        }
        await fetchEvents(activeTab);
        await refreshCounts();
        await fetchAllEvents();
      } catch (error) {
        setLoadState({
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "Could not update report status."
        });
      } finally {
        setPendingId(null);
      }
    },
    [activeTab, fetchEvents, refreshCounts, fetchAllEvents]
  );

  const totalReports = allEvents.length;
  const withPhoto = useMemo(
    () => allEvents.filter((event) => event.photoLocalUri || event.photoStorageKey).length,
    [allEvents]
  );
  const uniqueDrivers = useMemo(
    () => new Set(allEvents.map((event) => event.userId)).size,
    [allEvents]
  );
  const uniqueTrips = useMemo(
    () =>
      new Set(allEvents.map((event) => event.tripId).filter((id): id is string => Boolean(id))).size,
    [allEvents]
  );
  const byType = useMemo(() => {
    const map = new Map<string, number>();
    for (const event of allEvents) {
      map.set(event.type, (map.get(event.type) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [allEvents]);
  const bySeverity = useMemo(() => {
    const map = new Map<string, number>();
    for (const event of allEvents) {
      map.set(event.severity, (map.get(event.severity) ?? 0) + 1);
    }
    return ["low", "medium", "high", "critical"]
      .map((sev) => [sev, map.get(sev) ?? 0] as const)
      .filter(([, n]) => n > 0);
  }, [allEvents]);
  const recentEvents = useMemo(
    () => [...allEvents].slice(0, 6),
    [allEvents]
  );
  const stats = useMemo(() => {
    const speeds = allEvents.map((e) => e.speedMph ?? Number.NaN);
    const severities = allEvents.map((e) => SEVERITY_ORDINAL[e.severity] ?? Number.NaN);
    const confidences = allEvents.map((e) => e.confidence ?? Number.NaN);
    const accuracies = allEvents.map((e) => e.accuracyMeters ?? Number.NaN);
    const hours = allEvents.map((e) => new Date(e.createdAt).getHours());

    const pairs: { x: string; y: string; r: number | null }[] = [
      { x: "Speed", y: "Severity", r: pearson(speeds, severities) },
      { x: "Speed", y: "Confidence", r: pearson(speeds, confidences) },
      { x: "Speed", y: "GPS accuracy", r: pearson(speeds, accuracies) },
      { x: "Severity", y: "Confidence", r: pearson(severities, confidences) },
      { x: "Severity", y: "GPS accuracy", r: pearson(severities, accuracies) },
      { x: "Hour of day", y: "Severity", r: pearson(hours, severities) }
    ];

    const validSpeeds = speeds.filter((v) => Number.isFinite(v));
    const validAccuracy = accuracies.filter((v) => Number.isFinite(v));
    const speedStats = meanStd(validSpeeds);
    const accStats = meanStd(validAccuracy);

    const hourBuckets = new Array(24).fill(0) as number[];
    for (const h of hours) {
      if (h >= 0 && h < 24) hourBuckets[h]++;
    }
    const dayBuckets = new Array(7).fill(0) as number[];
    for (const event of allEvents) {
      dayBuckets[new Date(event.createdAt).getDay()]++;
    }

    const typeCounts = new Map<string, number>();
    for (const event of allEvents) {
      typeCounts.set(event.type, (typeCounts.get(event.type) ?? 0) + 1);
    }

    const anomalies: {
      kind: string;
      detail: string;
      event: RoadEvent;
    }[] = [];

    for (const event of allEvents) {
      if (
        event.speedMph != null &&
        speedStats.std > 0 &&
        Math.abs(event.speedMph - speedStats.mean) / speedStats.std > 2.5
      ) {
        anomalies.push({
          kind: "speed outlier",
          detail: `${event.speedMph.toFixed(1)} mph vs mean ${speedStats.mean.toFixed(1)}`,
          event
        });
      }
      if (
        event.accuracyMeters != null &&
        accStats.std > 0 &&
        (event.accuracyMeters - accStats.mean) / accStats.std > 2.5
      ) {
        anomalies.push({
          kind: "low GPS accuracy",
          detail: `±${Math.round(event.accuracyMeters)}m vs mean ±${Math.round(accStats.mean)}m`,
          event
        });
      }
      const typeCount = typeCounts.get(event.type) ?? 0;
      if (typeCount === 1 && allEvents.length >= 10) {
        anomalies.push({
          kind: "rare event type",
          detail: `Only ${formatEventType(event.type)} reported in the window`,
          event
        });
      }
      if (event.confidence < 0.4) {
        anomalies.push({
          kind: "low confidence",
          detail: `Reported with ${Math.round(event.confidence * 100)}% confidence`,
          event
        });
      }
    }

    const typeSeverityMatrix: { type: string; severity: string; count: number }[] = [];
    const matrixMap = new Map<string, number>();
    for (const event of allEvents) {
      const key = `${event.type}__${event.severity}`;
      matrixMap.set(key, (matrixMap.get(key) ?? 0) + 1);
    }
    for (const [key, count] of matrixMap.entries()) {
      const [type, severity] = key.split("__");
      typeSeverityMatrix.push({ type, severity, count });
    }

    return {
      pairs,
      speedStats,
      accStats,
      hourBuckets,
      dayBuckets,
      anomalies: anomalies.slice(0, 8),
      typeSeverityMatrix,
      typesPresent: [...typeCounts.keys()]
    };
  }, [allEvents]);

  const hotspots = useMemo(() => {
    const buckets = new Map<string, { lat: number; lng: number; count: number }>();
    for (const event of allEvents) {
      const key = `${event.lat.toFixed(3)},${event.lng.toFixed(3)}`;
      const current = buckets.get(key);
      if (current) {
        current.count += 1;
      } else {
        buckets.set(key, { lat: event.lat, lng: event.lng, count: 1 });
      }
    }
    return [...buckets.values()]
      .filter((bucket) => bucket.count > 1)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [allEvents]);

  const sectionTitle =
    SECTIONS.find((section) => section.id === activeSection)?.label ?? "";

  return (
    <main>
      <div className="page-shell">
        <header className="header">
          <div>
            <p className="eyebrow">Civik Municipal Console</p>
            <h1>{sectionTitle}</h1>
            <p className="subtitle">
              The chief&apos;s view of road intelligence flowing in from Civik
              drivers — live reports, analysis, and the people and vehicles
              behind them.
            </p>
          </div>
          <div className="header-aside">
            <div className="stat">
              <span className="stat-value">{counts.queued}</span>
              <span className="stat-label">awaiting acknowledgement</span>
            </div>
            <span className="muni-refreshed muted">
              Updated {formatTimeAgo(new Date(lastRefreshed).toISOString())}
            </span>
          </div>
        </header>

        <Link href="/" className="muni-back">
          ← All road events
        </Link>

        <nav className="muni-sections" aria-label="Console sections">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`muni-section ${activeSection === section.id ? "is-active" : ""}`}
              onClick={() => setActiveSection(section.id)}
            >
              <span className="muni-section-icon" aria-hidden="true">
                {section.icon}
              </span>
              <span className="muni-section-label">{section.label}</span>
            </button>
          ))}
        </nav>

        {activeSection === "live" ? (
          <LiveSection
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            counts={counts}
            roadEvents={roadEvents}
            loadState={loadState}
            updateStatus={updateStatus}
            pendingId={pendingId}
          />
        ) : null}

        {activeSection === "tasks" ? (
          <TasksSection
            roadEvents={roadEvents}
            queuedCount={counts.queued}
            ackCount={counts.acknowledged}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            updateStatus={updateStatus}
            pendingId={pendingId}
          />
        ) : null}

        {activeSection === "data-collection" ? (
          <DataCollectionSection
            totalReports={totalReports}
            withPhoto={withPhoto}
            uniqueDrivers={uniqueDrivers}
            uniqueTrips={uniqueTrips}
            recentEvents={recentEvents}
          />
        ) : null}

        {activeSection === "data-analysis" ? (
          <DataAnalysisSection
            byType={byType}
            bySeverity={bySeverity}
            total={totalReports}
            stats={stats}
          />
        ) : null}

        {activeSection === "insights" ? (
          <InsightsSection
            hotspots={hotspots}
            byType={byType}
            total={totalReports}
            anomalies={stats.anomalies}
          />
        ) : null}

        {activeSection === "drivers" ? (
          <PlaceholderSection
            title="Drivers"
            tagline="Roster, contribution, safety score"
            description="Every Civik driver who reports in your jurisdiction. Sort by reports submitted, photo evidence rate, hours on the road, and incident-free streak."
            bullets={[
              "Top contributors this week",
              "Drivers with photo + GPS evidence",
              "Drivers near high-priority hot spots",
              "Reach out to a fleet driver about a specific report"
            ]}
            metric={{ value: uniqueDrivers, label: "drivers contributing" }}
          />
        ) : null}

        {activeSection === "users" ? (
          <PlaceholderSection
            title="Users"
            tagline="Residents, council members, contractors"
            description="People who consume the data — residents subscribed to alerts on their block, council members watching their districts, contractors assigned to patch jobs."
            bullets={[
              "Resident alert subscribers",
              "Council / district views",
              "Contractor accounts for assigned jobs",
              "Audit log of who acknowledged what"
            ]}
            metric={{ value: "—", label: "user accounts (auth not wired)" }}
          />
        ) : null}

        {activeSection === "cars" ? (
          <CarViewSection mediaClips={mediaClips} />
        ) : null}

        {activeSection === "goals" ? (
          <PlaceholderSection
            title="Goals"
            tagline="What the chief is measured on"
            description="Set quarterly targets and watch them in real time. Time-to-acknowledge, time-to-resolve, % of reports with photo evidence, hot-spot reduction."
            bullets={[
              "Median time to acknowledge < 24h",
              "Median time to resolve < 14 days",
              "≥ 80% of reports with photo + GPS",
              "Reduce repeat reports at top 5 hot spots by 50%"
            ]}
            metric={{
              value: totalReports > 0 ? `${Math.round((withPhoto / totalReports) * 100)}%` : "—",
              label: "reports with photo evidence today"
            }}
          />
        ) : null}

        {activeSection === "other-visions" ? (
          <PlaceholderSection
            title="Other visions"
            tagline="Where Civik Municipal is going"
            description="Direction items. Not built yet — here so the team can see where the console is headed."
            bullets={[
              "Auto-routing to the right 311 / SeeClickFix endpoint per jurisdiction",
              "Admin-boundary detection via OSM so reports land in the right city",
              "Severity ML from photo + speed delta",
              "Public-facing transparency view per neighborhood",
              "Contractor work order generation from acknowledged reports",
              "Cross-jurisdiction emerging-markets deployment (phone-mount cars)"
            ]}
            metric={{ value: "roadmap", label: "" }}
          />
        ) : null}
      </div>
    </main>
  );
}

type LiveSectionProps = {
  activeTab: MunicipalReportStatus;
  setActiveTab: (tab: MunicipalReportStatus) => void;
  counts: Record<MunicipalReportStatus, number>;
  roadEvents: RoadEvent[];
  loadState: LoadState;
  updateStatus: (id: string, status: MunicipalReportStatus) => void;
  pendingId: string | null;
};

function LiveSection({
  activeTab,
  setActiveTab,
  counts,
  roadEvents,
  loadState,
  updateStatus,
  pendingId
}: LiveSectionProps) {
  return (
    <>
      <div className="muni-tabs" role="tablist">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`muni-tab ${activeTab === tab.id ? "is-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            <span className="muni-tab-count">{counts[tab.id]}</span>
          </button>
        ))}
      </div>

      {loadState.status === "loading" ? (
        <div className="loading-panel">Loading reports...</div>
      ) : null}

      {loadState.status === "error" ? (
        <div className="error">API unavailable: {loadState.error}</div>
      ) : null}

      {loadState.status === "success" && roadEvents.length === 0 ? (
        <div className="empty">
          No reports in &ldquo;{STATUS_LABEL[activeTab]}&rdquo; right now.
        </div>
      ) : null}

      {roadEvents.length > 0 ? (
        <>
          <section className="map-section" aria-label="Reports map">
            <RoadEventsMap roadEvents={roadEvents} />
          </section>

          <ul className="report-grid">
            {roadEvents.map((event) => (
              <ReportCard
                key={event.id}
                event={event}
                pendingId={pendingId}
                updateStatus={updateStatus}
              />
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

type TasksSectionProps = {
  roadEvents: RoadEvent[];
  queuedCount: number;
  ackCount: number;
  activeTab: MunicipalReportStatus;
  setActiveTab: (tab: MunicipalReportStatus) => void;
  updateStatus: (id: string, status: MunicipalReportStatus) => void;
  pendingId: string | null;
};

function TasksSection({
  roadEvents,
  queuedCount,
  ackCount,
  activeTab,
  setActiveTab,
  updateStatus,
  pendingId
}: TasksSectionProps) {
  return (
    <>
      <div className="muni-kpis">
        <KpiCard value={queuedCount} label="Open tasks (queued)" tone="warn" />
        <KpiCard value={ackCount} label="In progress (acknowledged)" tone="info" />
        <KpiCard value={queuedCount + ackCount} label="Total open" tone="default" />
      </div>

      <div className="muni-tabs" role="tablist">
        {STATUS_TABS.filter((t) => t.id !== "resolved").map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`muni-tab ${activeTab === tab.id ? "is-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label === "Queued" ? "To do" : "In progress"}
          </button>
        ))}
      </div>

      {roadEvents.length === 0 ? (
        <div className="empty">No open tasks. Nice.</div>
      ) : (
        <ul className="report-grid">
          {roadEvents.map((event) => (
            <ReportCard
              key={event.id}
              event={event}
              pendingId={pendingId}
              updateStatus={updateStatus}
            />
          ))}
        </ul>
      )}
    </>
  );
}

type DataCollectionSectionProps = {
  totalReports: number;
  withPhoto: number;
  uniqueDrivers: number;
  uniqueTrips: number;
  recentEvents: RoadEvent[];
};

function DataCollectionSection({
  totalReports,
  withPhoto,
  uniqueDrivers,
  uniqueTrips,
  recentEvents
}: DataCollectionSectionProps) {
  const photoRate =
    totalReports > 0 ? Math.round((withPhoto / totalReports) * 100) : 0;
  return (
    <>
      <div className="muni-kpis">
        <KpiCard value={totalReports} label="Reports collected" tone="default" />
        <KpiCard value={`${photoRate}%`} label="With photo + GPS" tone="info" />
        <KpiCard value={uniqueDrivers} label="Distinct drivers" tone="default" />
        <KpiCard value={uniqueTrips} label="Distinct trips" tone="default" />
      </div>

      <div className="muni-panel">
        <h2>Recent intake</h2>
        {recentEvents.length === 0 ? (
          <p className="muted">No data collected yet.</p>
        ) : (
          <ul className="muni-feed">
            {recentEvents.map((event) => (
              <li key={event.id} className="muni-feed-item">
                <span className={`report-pill report-pill--${event.severity}`}>
                  {event.severity}
                </span>
                <span className="muni-feed-type">
                  {formatEventType(event.type)}
                </span>
                <span className="muted">
                  {event.lat.toFixed(4)}, {event.lng.toFixed(4)}
                </span>
                <span className="muted muni-feed-time">
                  {formatTimeAgo(event.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

type StatsBlock = {
  pairs: { x: string; y: string; r: number | null }[];
  speedStats: { mean: number; std: number };
  accStats: { mean: number; std: number };
  hourBuckets: number[];
  dayBuckets: number[];
  anomalies: { kind: string; detail: string; event: RoadEvent }[];
  typeSeverityMatrix: { type: string; severity: string; count: number }[];
  typesPresent: string[];
};

type DataAnalysisSectionProps = {
  byType: [string, number][];
  bySeverity: (readonly [string, number])[];
  total: number;
  stats: StatsBlock;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SEVERITY_ORDER = ["low", "medium", "high", "critical"];

function DataAnalysisSection({
  byType,
  bySeverity,
  total,
  stats
}: DataAnalysisSectionProps) {
  const maxType = byType.reduce((max, [, count]) => Math.max(max, count), 0);
  const maxHour = Math.max(1, ...stats.hourBuckets);
  const maxDay = Math.max(1, ...stats.dayBuckets);
  const maxMatrix = Math.max(
    1,
    ...stats.typeSeverityMatrix.map((cell) => cell.count)
  );

  const matrixLookup = new Map<string, number>();
  for (const cell of stats.typeSeverityMatrix) {
    matrixLookup.set(`${cell.type}__${cell.severity}`, cell.count);
  }

  return (
    <>
      <div className="muni-panel">
        <h2>By event type</h2>
        {byType.length === 0 ? (
          <p className="muted">No data yet.</p>
        ) : (
          <ul className="muni-bars">
            {byType.map(([type, count]) => (
              <li key={type} className="muni-bar">
                <span className="muni-bar-label">{formatEventType(type)}</span>
                <div className="muni-bar-track">
                  <div
                    className="muni-bar-fill"
                    style={{ width: `${maxType > 0 ? (count / maxType) * 100 : 0}%` }}
                  />
                </div>
                <span className="muni-bar-value">{count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="muni-panel">
        <h2>By severity</h2>
        {bySeverity.length === 0 ? (
          <p className="muted">No data yet.</p>
        ) : (
          <div className="muni-severity">
            {bySeverity.map(([sev, count]) => (
              <div key={sev} className={`muni-severity-cell muni-severity-cell--${sev}`}>
                <span className="muni-severity-count">{count}</span>
                <span className="muni-severity-label">{sev}</span>
                <span className="muted muni-severity-pct">
                  {total > 0 ? Math.round((count / total) * 100) : 0}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="muni-panel">
        <h2>Correlations (Pearson r)</h2>
        <p className="muted muni-help">
          Values from −1 (inverse) to +1 (direct). Anything past ±0.3 starts to
          mean something. n = {total}.
        </p>
        {total < 3 ? (
          <p className="muted">Need at least 3 reports to compute.</p>
        ) : (
          <ul className="muni-corr-grid">
            {stats.pairs.map((pair) => (
              <li
                key={`${pair.x}-${pair.y}`}
                className={`muni-corr-cell ${corrTone(pair.r)}`}
              >
                <span className="muni-corr-pair">
                  {pair.x} × {pair.y}
                </span>
                <span className="muni-corr-value">
                  {pair.r == null ? "—" : pair.r.toFixed(2)}
                </span>
                <span className="muted muni-corr-note">
                  {pair.r == null
                    ? "insufficient data"
                    : corrLabel(pair.r)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="muni-panel">
        <h2>Reports by hour of day</h2>
        {total === 0 ? (
          <p className="muted">No data yet.</p>
        ) : (
          <div className="muni-hist">
            {stats.hourBuckets.map((count, hour) => (
              <div key={hour} className="muni-hist-col">
                <div
                  className="muni-hist-bar"
                  style={{ height: `${(count / maxHour) * 100}%` }}
                  title={`${count} reports at ${hour}:00`}
                />
                <span className="muni-hist-label">
                  {hour % 3 === 0 ? hour : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="muni-panel">
        <h2>Reports by day of week</h2>
        {total === 0 ? (
          <p className="muted">No data yet.</p>
        ) : (
          <ul className="muni-bars">
            {stats.dayBuckets.map((count, day) => (
              <li key={day} className="muni-bar">
                <span className="muni-bar-label">{DAYS[day]}</span>
                <div className="muni-bar-track">
                  <div
                    className="muni-bar-fill"
                    style={{ width: `${(count / maxDay) * 100}%` }}
                  />
                </div>
                <span className="muni-bar-value">{count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="muni-panel">
        <h2>Type × severity heatmap</h2>
        {stats.typesPresent.length === 0 ? (
          <p className="muted">No data yet.</p>
        ) : (
          <div className="muni-matrix-wrap">
            <table className="muni-matrix">
              <thead>
                <tr>
                  <th />
                  {SEVERITY_ORDER.map((sev) => (
                    <th key={sev}>{sev}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.typesPresent.map((type) => (
                  <tr key={type}>
                    <th scope="row">{formatEventType(type)}</th>
                    {SEVERITY_ORDER.map((sev) => {
                      const count = matrixLookup.get(`${type}__${sev}`) ?? 0;
                      const intensity = count / maxMatrix;
                      return (
                        <td
                          key={sev}
                          style={{
                            background:
                              count === 0
                                ? "#f7faff"
                                : `rgba(11, 92, 171, ${Math.max(0.08, intensity)})`,
                            color: intensity > 0.55 ? "#ffffff" : "#172026"
                          }}
                        >
                          {count > 0 ? count : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="muni-panel">
        <h2>Variable summary</h2>
        <ul className="muni-vars">
          <li>
            <span className="muni-var-label">Speed</span>
            <span className="muni-var-value">
              μ {stats.speedStats.mean.toFixed(1)} mph · σ{" "}
              {stats.speedStats.std.toFixed(1)}
            </span>
          </li>
          <li>
            <span className="muni-var-label">GPS accuracy</span>
            <span className="muni-var-value">
              μ ±{stats.accStats.mean.toFixed(1)}m · σ{" "}
              {stats.accStats.std.toFixed(1)}
            </span>
          </li>
          <li>
            <span className="muni-var-label">Sample size</span>
            <span className="muni-var-value">{total} reports</span>
          </li>
        </ul>
      </div>
    </>
  );
}

function corrTone(r: number | null): string {
  if (r == null) return "muni-corr-cell--neutral";
  const a = Math.abs(r);
  if (a >= 0.6) return "muni-corr-cell--strong";
  if (a >= 0.3) return "muni-corr-cell--moderate";
  return "muni-corr-cell--weak";
}

function corrLabel(r: number): string {
  const a = Math.abs(r);
  const direction = r >= 0 ? "positive" : "negative";
  if (a >= 0.6) return `strong ${direction}`;
  if (a >= 0.3) return `moderate ${direction}`;
  if (a >= 0.1) return `weak ${direction}`;
  return "no relationship";
}

type InsightsSectionProps = {
  hotspots: { lat: number; lng: number; count: number }[];
  byType: [string, number][];
  total: number;
  anomalies: { kind: string; detail: string; event: RoadEvent }[];
};

function InsightsSection({
  hotspots,
  byType,
  total,
  anomalies
}: InsightsSectionProps) {
  const topType = byType[0];
  return (
    <>
      <div className="muni-panel">
        <h2>Headline</h2>
        {total === 0 ? (
          <p className="muted">
            No reports yet. Once drivers start submitting, insights show up here.
          </p>
        ) : (
          <ul className="muni-insights">
            {topType ? (
              <li>
                <strong>{formatEventType(topType[0])}</strong> is the most
                reported event ({topType[1]} of {total} reports).
              </li>
            ) : null}
            <li>
              {hotspots.length} location{hotspots.length === 1 ? "" : "s"} have
              more than one report on the same block.
            </li>
            <li>
              Photo evidence on inbound reports turns this into an audit trail —
              not just a complaint inbox.
            </li>
          </ul>
        )}
      </div>

      <div className="muni-panel">
        <h2>Hot spots</h2>
        {hotspots.length === 0 ? (
          <p className="muted">
            No repeat locations yet. Once two or more reports land on the same
            block, they cluster here.
          </p>
        ) : (
          <ul className="muni-hotspots">
            {hotspots.map((spot, index) => (
              <li key={`${spot.lat}-${spot.lng}`} className="muni-hotspot">
                <span className="muni-hotspot-rank">#{index + 1}</span>
                <a
                  href={osmLink(spot.lat, spot.lng)}
                  target="_blank"
                  rel="noreferrer"
                  className="muni-hotspot-link"
                >
                  {spot.lat.toFixed(4)}, {spot.lng.toFixed(4)}
                </a>
                <span className="muni-hotspot-count">{spot.count} reports</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="muni-panel">
        <h2>Anomalies</h2>
        <p className="muted muni-help">
          Reports that stand out — z-score &gt; 2.5 on speed or GPS accuracy,
          rare types, or low driver confidence. Worth a manual look.
        </p>
        {anomalies.length === 0 ? (
          <p className="muted">
            Nothing unusual in the current window. The data looks well-behaved.
          </p>
        ) : (
          <ul className="muni-anomalies">
            {anomalies.map((anomaly, index) => (
              <li
                key={`${anomaly.event.id}-${index}`}
                className="muni-anomaly"
              >
                <span className="muni-anomaly-kind">{anomaly.kind}</span>
                <span className="muni-anomaly-detail">{anomaly.detail}</span>
                <a
                  href={osmLink(anomaly.event.lat, anomaly.event.lng)}
                  target="_blank"
                  rel="noreferrer"
                  className="muni-anomaly-link"
                >
                  {formatEventType(anomaly.event.type)} ·{" "}
                  {anomaly.event.lat.toFixed(4)},{" "}
                  {anomaly.event.lng.toFixed(4)}
                </a>
                <span className="muted muni-anomaly-time">
                  {formatTimeAgo(anomaly.event.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

type CarViewSectionProps = {
  mediaClips: MediaClip[];
};

function CarViewSection({ mediaClips }: CarViewSectionProps) {
  const total = mediaClips.length;
  const uploaded = mediaClips.filter((c) => c.status === "uploaded").length;
  const pending = mediaClips.filter((c) => c.status === "pending_upload").length;
  const failed = mediaClips.filter((c) => c.status === "failed").length;
  const totalBytes = mediaClips.reduce(
    (sum, clip) => sum + (clip.sizeBytes ?? 0),
    0
  );
  const totalSeconds = mediaClips.reduce(
    (sum, clip) => sum + (clip.durationSeconds ?? 0),
    0
  );

  return (
    <>
      <div className="muni-panel muni-legal">
        <strong>Chain of custody</strong>
        <p>
          Every frame Civik holds is logged here. Each clip below names the
          driver-owned device that recorded it, where and when it was captured,
          duration, byte size, mime type, upload status, and the storage key
          used to retrieve it. Footage is held under the driver&apos;s account —
          access from this console requires a recorded reason and is itself
          audited.
        </p>
      </div>

      <div className="muni-kpis">
        <KpiCard value={total} label="Clips on file" tone="default" />
        <KpiCard value={uploaded} label="Uploaded" tone="info" />
        <KpiCard value={pending} label="Pending upload" tone="warn" />
        <KpiCard value={failed} label="Failed" tone="warn" />
      </div>

      <div className="muni-kpis">
        <KpiCard
          value={formatBytes(totalBytes)}
          label="Total footage size"
          tone="default"
        />
        <KpiCard
          value={formatDuration(totalSeconds)}
          label="Total footage duration"
          tone="default"
        />
      </div>

      {total === 0 ? (
        <div className="empty">
          No clips recorded yet. As soon as a driver records a trip with the
          camera on, clips land here with full chain-of-custody metadata.
        </div>
      ) : (
        <ul className="muni-clip-grid">
          {mediaClips.map((clip) => (
            <ClipCard key={clip.id} clip={clip} />
          ))}
        </ul>
      )}
    </>
  );
}

function ClipCard({ clip }: { clip: MediaClip }) {
  const hasLocation = clip.lat != null && clip.lng != null;
  return (
    <li className="muni-clip-card">
      <div className="muni-clip-head">
        <span className="muni-clip-icon" aria-hidden="true">
          📼
        </span>
        <div className="muni-clip-title">
          <span className="muni-clip-name">
            {clip.name ?? `Clip ${maskId(clip.id)}`}
          </span>
          <span className="muted muni-clip-sub">
            Trip {maskId(clip.tripId)} · driver {maskId(clip.userId)}
          </span>
        </div>
        <span className={`report-pill report-pill--clip clip-status--${clip.status}`}>
          {clip.status.replaceAll("_", " ")}
        </span>
      </div>

      <dl className="report-meta">
        <div>
          <dt>Recorded</dt>
          <dd>
            {clip.startedAt ? formatDate(clip.startedAt) : "—"}
            {clip.endedAt ? (
              <span className="muted"> → {formatDate(clip.endedAt)}</span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{formatDuration(clip.durationSeconds)}</dd>
        </div>
        <div>
          <dt>Size · mime</dt>
          <dd>
            {formatBytes(clip.sizeBytes)} · <span className="muted">{clip.mimeType}</span>
          </dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>
            {hasLocation ? (
              <a
                href={osmLink(clip.lat as number, clip.lng as number)}
                target="_blank"
                rel="noreferrer"
              >
                {(clip.lat as number).toFixed(5)},{" "}
                {(clip.lng as number).toFixed(5)}
              </a>
            ) : (
              <span className="muted">No GPS at end of clip</span>
            )}
            {clip.speedMph != null ? (
              <span className="muted"> · {clip.speedMph.toFixed(0)} mph</span>
            ) : null}
            {clip.accuracyMeters != null ? (
              <span className="muted"> · ±{Math.round(clip.accuracyMeters)}m</span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Storage key</dt>
          <dd className="muted muni-clip-key">
            {clip.storageKey ?? "Not yet uploaded"}
          </dd>
        </div>
        <div>
          <dt>Linked event</dt>
          <dd className="muted">
            {clip.roadEventId ? maskId(clip.roadEventId) : "—"}
          </dd>
        </div>
      </dl>

      <div className="muni-clip-actions">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!clip.storageKey}
          title={
            clip.storageKey
              ? "Open footage (would stream from object storage)"
              : "Clip not yet uploaded to object storage"
          }
        >
          ▶ Open footage
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          title="Records the chief's reason for accessing this clip — written to the audit log."
        >
          Log access reason
        </button>
      </div>
    </li>
  );
}

type PlaceholderSectionProps = {
  title: string;
  tagline: string;
  description: string;
  bullets: string[];
  metric: { value: number | string; label: string };
};

function PlaceholderSection({
  tagline,
  description,
  bullets,
  metric
}: PlaceholderSectionProps) {
  return (
    <div className="muni-placeholder">
      <div className="muni-placeholder-head">
        <div>
          <p className="eyebrow">{tagline}</p>
          <p className="muni-placeholder-desc">{description}</p>
        </div>
        <div className="muni-placeholder-metric">
          <span className="stat-value">{metric.value}</span>
          {metric.label ? <span className="stat-label">{metric.label}</span> : null}
        </div>
      </div>
      <ul className="muni-checklist">
        {bullets.map((bullet) => (
          <li key={bullet}>
            <span className="muni-checklist-dot" aria-hidden="true">
              ◯
            </span>
            {bullet}
          </li>
        ))}
      </ul>
      <p className="muted muni-placeholder-foot">
        Not wired yet — this is the chief&apos;s-eye view of where this section
        is going.
      </p>
    </div>
  );
}

function KpiCard({
  value,
  label,
  tone
}: {
  value: number | string;
  label: string;
  tone: "default" | "warn" | "info";
}) {
  return (
    <div className={`muni-kpi muni-kpi--${tone}`}>
      <span className="muni-kpi-value">{value}</span>
      <span className="muni-kpi-label">{label}</span>
    </div>
  );
}

type ReportCardProps = {
  event: RoadEvent;
  pendingId: string | null;
  updateStatus: (id: string, status: MunicipalReportStatus) => void;
};

function ReportCard({ event, pendingId, updateStatus }: ReportCardProps) {
  const hasPhoto = Boolean(event.photoLocalUri || event.photoStorageKey);
  const isPending = pendingId === event.id;

  return (
    <li className="report-card">
      <div className="report-photo">
        {hasPhoto ? (
          <div className="report-photo-placeholder">
            <span className="report-photo-icon">📷</span>
            <span>Photo on driver device</span>
            <span className="muted">
              {event.photoStorageKey ? "Uploaded" : "Awaiting upload"}
            </span>
          </div>
        ) : (
          <div className="report-photo-placeholder">
            <span className="report-photo-icon">📍</span>
            <span>GPS-only report</span>
          </div>
        )}
      </div>

      <div className="report-body">
        <div className="report-head">
          <span className="report-type">{formatEventType(event.type)}</span>
          <span className={`report-pill report-pill--${event.severity}`}>
            {event.severity}
          </span>
          <span
            className={`report-pill report-pill--status report-pill--${event.municipalStatus}`}
          >
            {STATUS_LABEL[event.municipalStatus]}
          </span>
        </div>

        {event.note ? (
          <p className="report-note">&ldquo;{event.note}&rdquo;</p>
        ) : (
          <p className="report-note muted">No driver note</p>
        )}

        <dl className="report-meta">
          <div>
            <dt>Location</dt>
            <dd>
              <a
                href={osmLink(event.lat, event.lng)}
                target="_blank"
                rel="noreferrer"
              >
                {event.lat.toFixed(5)}, {event.lng.toFixed(5)}
              </a>
              {event.accuracyMeters ? (
                <span className="muted">
                  {" "}
                  · ±{Math.round(event.accuracyMeters)}m
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Reported</dt>
            <dd>{formatDate(event.createdAt)}</dd>
          </div>
          <div>
            <dt>Trip</dt>
            <dd className="muted">{event.tripId ?? "—"}</dd>
          </div>
        </dl>

        <div className="report-actions">
          {event.municipalStatus === "queued" ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={isPending}
              onClick={() => updateStatus(event.id, "acknowledged")}
            >
              {isPending ? "Updating..." : "Acknowledge"}
            </button>
          ) : null}

          {event.municipalStatus === "acknowledged" ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={isPending}
              onClick={() => updateStatus(event.id, "resolved")}
            >
              {isPending ? "Updating..." : "Mark resolved"}
            </button>
          ) : null}

          {event.municipalStatus !== "queued" ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={isPending}
              onClick={() => updateStatus(event.id, "queued")}
            >
              Send back to queue
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
