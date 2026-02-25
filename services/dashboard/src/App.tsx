import { useState, useEffect, useCallback } from "react";

type Metrics = {
  goroutines: number;
  heap_alloc_mb: number;
  sys_mb: number;
  gc_cycles: number;
  uptime_seconds: number;
};

type Health = {
  status: string;
  service: string;
  uptime_seconds: number;
};

type RustHealth = {
  status: string;
};

type LogEntry = {
  id: number;
  timestamp: string;
  method: string;
  path: string;
  status: number | null;
  duration_ms: number;
  summary: string;
  ok: boolean;
};

type ApiResult = {
  ok: boolean;
  status: number | null;
  data: unknown;
  duration_ms: number;
};

let logId = 0;

const apiCall = async (
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult> => {
  const start = performance.now();
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const duration_ms = Math.round(performance.now() - start);
    let data: unknown = null;
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { ok: res.ok, status: res.status, data, duration_ms };
  } catch {
    const duration_ms = Math.round(performance.now() - start);
    return { ok: false, status: null, data: null, duration_ms };
  }
};

const StatusBadge = ({ ok }: { ok: boolean }) => (
  <span
    className={`inline-block w-2.5 h-2.5 rounded-full ${ok ? "bg-green-400" : "bg-red-500"}`}
  />
);

const MetricCard = ({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number;
  unit?: string;
}) => (
  <div className="bg-gray-800 rounded-lg p-4">
    <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">
      {label}
    </div>
    <div className="text-2xl font-mono font-bold text-white">
      {value}
      {unit && <span className="text-sm text-gray-400 ml-1">{unit}</span>}
    </div>
  </div>
);

const ExperimentButton = ({
  label,
  loading,
  onClick,
  variant = "default",
}: {
  label: string;
  loading: boolean;
  onClick: () => void;
  variant?: "default" | "danger" | "success";
}) => {
  const colors = {
    default: "bg-blue-600 hover:bg-blue-500",
    danger: "bg-orange-600 hover:bg-orange-500",
    success: "bg-emerald-600 hover:bg-emerald-500",
  };
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`w-full px-4 py-2.5 rounded-lg font-medium text-sm text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${colors[variant]}`}
    >
      {loading ? "..." : label}
    </button>
  );
};

const formatUptime = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

export const App = () => {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [rustHealth, setRustHealth] = useState<RustHealth | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>(
    {},
  );

  const addLog = useCallback(
    (method: string, path: string, result: ApiResult, summary: string) => {
      const entry: LogEntry = {
        id: ++logId,
        timestamp: new Date().toLocaleTimeString(),
        method,
        path,
        status: result.status,
        duration_ms: result.duration_ms,
        summary,
        ok: result.ok,
      };
      setLogs((prev) => [entry, ...prev].slice(0, 100));
    },
    [],
  );

  const runExperiment = useCallback(
    async (
      key: string,
      method: string,
      path: string,
      body?: unknown,
      summaryFn?: (data: unknown) => string,
    ) => {
      setLoadingStates((prev) => ({ ...prev, [key]: true }));
      const result = await apiCall(method, path, body);
      const summary = result.ok
        ? (summaryFn?.(result.data) ?? "ok")
        : result.status
          ? `error ${result.status}`
          : "unreachable";
      addLog(method, path, result, summary);
      setLoadingStates((prev) => ({ ...prev, [key]: false }));
    },
    [addLog],
  );

  // poll metrics every 2s
  useEffect(() => {
    const fetchMetrics = async () => {
      const result = await apiCall("GET", "/api/metrics");
      if (result.ok && result.data) {
        setMetrics(result.data as Metrics);
      }
    };
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 2000);
    return () => clearInterval(interval);
  }, []);

  // poll go-api health every 5s
  useEffect(() => {
    const fetchHealth = async () => {
      const result = await apiCall("GET", "/api/health");
      if (result.ok && result.data) {
        setHealth(result.data as Health);
      } else {
        setHealth(null);
      }
    };
    fetchHealth();
    const interval = setInterval(fetchHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  // poll rust-processor health every 5s
  useEffect(() => {
    const fetchRustHealth = async () => {
      const result = await apiCall("GET", "/api/rust-health");
      if (result.ok && result.data) {
        setRustHealth(result.data as RustHealth);
      } else {
        setRustHealth(null);
      }
    };
    fetchRustHealth();
    const interval = setInterval(fetchRustHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  const goUp = health !== null;
  const rustUp = rustHealth !== null && rustHealth.status === "ok";

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="text-red-400">k</span>
          <span className="text-gray-400">-</span>
          <span className="text-white">os</span>
        </h1>
        <p className="text-sm text-gray-500 mt-1">Scale Learning Lab</p>
      </header>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — Service health */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
            Services
          </h2>

          {/* Go API health card */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <StatusBadge ok={goUp} />
              <span className="font-medium">Go API</span>
              <span className="ml-auto text-xs text-gray-500">
                {goUp ? "healthy" : "unreachable"}
              </span>
            </div>
            {health && (
              <div className="text-xs text-gray-400 space-y-1">
                <div>
                  Service:{" "}
                  <span className="text-gray-300">{health.service}</span>
                </div>
                <div>
                  Uptime:{" "}
                  <span className="text-gray-300">
                    {formatUptime(health.uptime_seconds)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Rust Processor health card */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <StatusBadge ok={rustUp} />
              <span className="font-medium">Rust Processor</span>
              <span className="ml-auto text-xs text-gray-500">
                {rustUp ? "healthy" : "unreachable"}
              </span>
            </div>
            {rustHealth && (
              <div className="text-xs text-gray-400">
                Status:{" "}
                <span className="text-gray-300">{rustHealth.status}</span>
              </div>
            )}
          </div>
        </div>

        {/* Center column — Metrics */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
            Metrics
          </h2>

          {metrics ? (
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="Goroutines" value={metrics.goroutines} />
              <MetricCard
                label="Heap"
                value={metrics.heap_alloc_mb.toFixed(1)}
                unit="MB"
              />
              <MetricCard label="GC Cycles" value={metrics.gc_cycles} />
              <MetricCard
                label="Uptime"
                value={formatUptime(metrics.uptime_seconds)}
              />
              <MetricCard
                label="Sys Memory"
                value={metrics.sys_mb.toFixed(1)}
                unit="MB"
              />
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500">
              Waiting for metrics...
            </div>
          )}
        </div>

        {/* Right column — Experiments */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
            Experiments
          </h2>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
            <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-2">
              Go API
            </h3>
            <ExperimentButton
              label="Send Work Request"
              loading={!!loadingStates["work"]}
              onClick={() =>
                runExperiment(
                  "work",
                  "POST",
                  "/api/work?duration_ms=200",
                  undefined,
                  () => "work completed",
                )
              }
            />
            <ExperimentButton
              label="Allocate 10MB"
              loading={!!loadingStates["alloc10"]}
              variant="danger"
              onClick={() =>
                runExperiment(
                  "alloc10",
                  "GET",
                  "/api/allocate?mb=10",
                  undefined,
                  () => "allocated 10MB",
                )
              }
            />
            <ExperimentButton
              label="Allocate 50MB"
              loading={!!loadingStates["alloc50"]}
              variant="danger"
              onClick={() =>
                runExperiment(
                  "alloc50",
                  "GET",
                  "/api/allocate?mb=50",
                  undefined,
                  () => "allocated 50MB",
                )
              }
            />
            <ExperimentButton
              label="Release Memory"
              loading={!!loadingStates["release"]}
              variant="success"
              onClick={() =>
                runExperiment(
                  "release",
                  "GET",
                  "/api/allocate?release=true",
                  undefined,
                  () => "memory released",
                )
              }
            />
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
            <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-2">
              Rust Processor
            </h3>
            <ExperimentButton
              label="Process Data (Rust)"
              loading={!!loadingStates["process"]}
              onClick={() =>
                runExperiment(
                  "process",
                  "POST",
                  "/api/process",
                  {
                    text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
                  },
                  (data) => {
                    const d = data as Record<string, unknown>;
                    return `processed: ${d.word_count ?? "?"} words`;
                  },
                )
              }
            />
            <ExperimentButton
              label="Crunch 10MB (Rust)"
              loading={!!loadingStates["crunch"]}
              variant="danger"
              onClick={() =>
                runExperiment(
                  "crunch",
                  "GET",
                  "/api/crunch?mb=10",
                  undefined,
                  () => "crunch completed",
                )
              }
            />
          </div>
        </div>
      </div>

      {/* Event log */}
      <div className="mt-8">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">
          Event Log
        </h2>
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="max-h-72 overflow-y-auto">
            {logs.length === 0 ? (
              <div className="p-6 text-center text-gray-600 text-sm">
                No events yet. Run an experiment to see results here.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                  <tr className="text-left text-xs text-gray-500 uppercase">
                    <th className="px-4 py-2">Time</th>
                    <th className="px-4 py-2">Method</th>
                    <th className="px-4 py-2">Path</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Duration</th>
                    <th className="px-4 py-2">Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-b border-gray-800/50 hover:bg-gray-800/30"
                    >
                      <td className="px-4 py-2 font-mono text-gray-400">
                        {log.timestamp}
                      </td>
                      <td className="px-4 py-2 font-mono text-gray-300">
                        {log.method}
                      </td>
                      <td className="px-4 py-2 font-mono text-gray-400 max-w-48 truncate">
                        {log.path}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`font-mono ${log.ok ? "text-green-400" : "text-red-400"}`}
                        >
                          {log.status ?? "ERR"}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-gray-400">
                        {log.duration_ms}ms
                      </td>
                      <td className="px-4 py-2 text-gray-300">{log.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
