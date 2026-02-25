package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"log/slog"
	"math/rand"
	"net/http"
	"net/http/pprof"
	"os"
	"os/signal"
	"runtime"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
)

// ---------------------------------------------------------------------------
// Structured logging: ContextHandler + AppendCtx
// ---------------------------------------------------------------------------

type ctxKey struct{}

// AppendCtx adds slog attributes to the context so they appear in every log
// line produced within that context.
func AppendCtx(ctx context.Context, attrs ...slog.Attr) context.Context {
	existing, _ := ctx.Value(ctxKey{}).([]slog.Attr)
	return context.WithValue(ctx, ctxKey{}, append(existing, attrs...))
}

// ContextHandler wraps an slog.Handler and extracts attributes stored in the
// context before each log call.
type ContextHandler struct {
	inner slog.Handler
}

func NewContextHandler(inner slog.Handler) *ContextHandler {
	return &ContextHandler{inner: inner}
}

func (h *ContextHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.inner.Enabled(ctx, level)
}

func (h *ContextHandler) Handle(ctx context.Context, r slog.Record) error {
	if attrs, ok := ctx.Value(ctxKey{}).([]slog.Attr); ok {
		for _, a := range attrs {
			r.AddAttrs(a)
		}
	}
	return h.inner.Handle(ctx, r)
}

func (h *ContextHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return NewContextHandler(h.inner.WithAttrs(attrs))
}

func (h *ContextHandler) WithGroup(name string) slog.Handler {
	return NewContextHandler(h.inner.WithGroup(name))
}

// ---------------------------------------------------------------------------
// Global retained memory (for /allocate OOMKill experiments)
// ---------------------------------------------------------------------------

var (
	retained   [][]byte
	retainedMu sync.Mutex
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ---------------------------------------------------------------------------
// Middleware: request ID
// ---------------------------------------------------------------------------

func requestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := uuid.New().String()
		ctx := AppendCtx(r.Context(), slog.String("request_id", id))
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

func healthHandler(startTime time.Time) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		uptime := time.Since(startTime).Seconds()

		slog.DebugContext(ctx, "health check", "uptime_seconds", uptime)

		writeJSON(w, http.StatusOK, map[string]any{
			"status":         "ok",
			"service":        "go-api",
			"uptime_seconds": int(uptime),
		})
	}
}

func workHandler(defaultDurationMS int) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		durationMS := defaultDurationMS
		if v := r.URL.Query().Get("duration_ms"); v != "" {
			if parsed, err := strconv.Atoi(v); err == nil && parsed >= 0 {
				durationMS = parsed
			}
		}

		start := time.Now()

		// Simulate latency.
		time.Sleep(time.Duration(durationMS) * time.Millisecond)

		// CPU work: hash a string repeatedly.
		iterations := 1000
		data := []byte("k-os-cpu-work")
		for i := 0; i < iterations; i++ {
			h := sha256.Sum256(data)
			data = h[:]
		}

		elapsed := time.Since(start).Milliseconds()

		slog.InfoContext(ctx, "work completed",
			"duration_ms", elapsed,
			"iterations", iterations,
		)

		writeJSON(w, http.StatusOK, map[string]any{
			"status":      "completed",
			"duration_ms": elapsed,
			"iterations":  iterations,
		})
	}
}

func allocateHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		// Release path.
		if r.URL.Query().Get("release") == "true" {
			retainedMu.Lock()
			retained = nil
			retainedMu.Unlock()

			slog.InfoContext(ctx, "memory released")

			writeJSON(w, http.StatusOK, map[string]any{
				"status":            "released",
				"total_retained_mb": 0,
				"num_allocations":   0,
			})
			return
		}

		// Allocate path.
		mb := 10
		if v := r.URL.Query().Get("mb"); v != "" {
			if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 {
				mb = parsed
			}
		}

		size := mb * 1024 * 1024
		buf := make([]byte, size)

		// Fill with random-ish data so the runtime can't optimize it away.
		for i := range buf {
			buf[i] = byte(rand.Intn(256)) //nolint:gosec // intentional; not crypto
		}

		retainedMu.Lock()
		retained = append(retained, buf)
		totalMB := 0
		for _, b := range retained {
			totalMB += len(b) / (1024 * 1024)
		}
		count := len(retained)
		retainedMu.Unlock()

		slog.InfoContext(ctx, "memory allocated",
			"requested_mb", mb,
			"total_retained_mb", totalMB,
			"num_allocations", count,
		)

		writeJSON(w, http.StatusOK, map[string]any{
			"status":            "allocated",
			"requested_mb":      mb,
			"total_retained_mb": totalMB,
			"num_allocations":   count,
		})
	}
}

func metricsHandler(startTime time.Time) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var mem runtime.MemStats
		runtime.ReadMemStats(&mem)

		writeJSON(w, http.StatusOK, map[string]any{
			"goroutines":     runtime.NumGoroutine(),
			"heap_alloc_mb":  float64(mem.HeapAlloc) / (1024 * 1024),
			"sys_mb":         float64(mem.Sys) / (1024 * 1024),
			"gc_cycles":      mem.NumGC,
			"uptime_seconds": int(time.Since(startTime).Seconds()),
		})
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

func main() {
	// --- Logger setup ---
	logLevel := slog.LevelInfo
	if envOrDefault("LOG_LEVEL", "info") == "debug" {
		logLevel = slog.LevelDebug
	}

	jsonHandler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		AddSource: true,
		Level:     logLevel,
	})
	logger := slog.New(NewContextHandler(jsonHandler))
	slog.SetDefault(logger)

	// --- Config ---
	port := envOrDefault("PORT", "8080")
	defaultWorkDuration, _ := strconv.Atoi(envOrDefault("WORK_DURATION_MS", "100"))
	startTime := time.Now()

	// --- Mux ---
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", healthHandler(startTime))
	mux.HandleFunc("GET /work", workHandler(defaultWorkDuration))
	mux.HandleFunc("GET /allocate", allocateHandler())
	mux.HandleFunc("GET /metrics", metricsHandler(startTime))

	// pprof
	mux.HandleFunc("GET /debug/pprof/", pprof.Index)
	mux.HandleFunc("GET /debug/pprof/cmdline", pprof.Cmdline)
	mux.HandleFunc("GET /debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("GET /debug/pprof/symbol", pprof.Symbol)
	mux.HandleFunc("GET /debug/pprof/trace", pprof.Trace)

	// --- Server ---
	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      requestIDMiddleware(mux),
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// --- Graceful shutdown ---
	done := make(chan os.Signal, 1)
	signal.Notify(done, syscall.SIGTERM, syscall.SIGINT)

	go func() {
		slog.Info("server starting", "port", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	sig := <-done
	slog.Info("shutting down", "signal", sig.String())

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown error", "error", err)
	}

	slog.Info("shutdown complete")
}
