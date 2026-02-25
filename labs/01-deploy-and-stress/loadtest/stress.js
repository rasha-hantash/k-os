import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const errorRate = new Rate("errors");
const goApiDuration = new Trend("go_api_duration", true);

const BASE_URL = __ENV.BASE_URL || "http://localhost";

export const options = {
  stages: [
    { duration: "30s", target: 10 }, // warm up
    { duration: "30s", target: 100 }, // ramp up
    { duration: "30s", target: 500 }, // peak load
    { duration: "30s", target: 0 }, // ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<2000"],
    errors: ["rate<0.1"],
  },
};

export default function () {
  // Hit the Go API /work endpoint
  const workRes = http.get(`${BASE_URL}/api/work?duration_ms=50`);
  check(workRes, {
    "work status 200": (r) => r.status === 200,
  });
  errorRate.add(workRes.status !== 200);
  goApiDuration.add(workRes.timings.duration);

  // Hit Go API health
  const healthRes = http.get(`${BASE_URL}/api/health`);
  check(healthRes, {
    "health status 200": (r) => r.status === 200,
  });
  errorRate.add(healthRes.status !== 200);

  sleep(0.1);
}
