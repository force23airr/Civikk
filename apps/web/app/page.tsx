import type { RoadEvent } from "@civik/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

async function getRoadEvents(): Promise<{
  roadEvents: RoadEvent[];
  error?: string;
}> {
  try {
    const response = await fetch(`${API_URL}/api/road-events`, {
      cache: "no-store"
    });

    if (!response.ok) {
      return {
        roadEvents: [],
        error: `API returned ${response.status}`
      };
    }

    return response.json() as Promise<{ roadEvents: RoadEvent[] }>;
  } catch (error) {
    return {
      roadEvents: [],
      error: error instanceof Error ? error.message : "Could not fetch events."
    };
  }
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

export default async function DashboardPage() {
  const { roadEvents, error } = await getRoadEvents();

  return (
    <main>
      <div className="page-shell">
        <header className="header">
          <div>
            <p className="eyebrow">Civik Road Intelligence</p>
            <h1>Road events</h1>
            <p className="subtitle">
              Manual reports from driver trips. The table is the first dashboard
              milestone before map rendering.
            </p>
          </div>
          <div className="stat">
            <span className="stat-value">{roadEvents.length}</span>
            <span className="stat-label">reported events</span>
          </div>
        </header>

        {error ? <div className="error">API unavailable: {error}</div> : null}

        {!error && roadEvents.length === 0 ? (
          <div className="empty">No road events have been reported yet.</div>
        ) : null}

        {roadEvents.length > 0 ? (
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
        ) : null}
      </div>
    </main>
  );
}
