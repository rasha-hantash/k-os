import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const errorRate = new Rate("errors");
const BASE_URL = __ENV.BASE_URL || "http://localhost";

export const options = {
  scenarios: {
    sustained: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 50 },
        { duration: "3m", target: 50 }, // sustained load to trigger scale-up
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    errors: ["rate<0.1"],
  },
};

export default function () {
  // CPU-intensive work to trigger HPA
  const res = http.get(`${BASE_URL}/api/work?duration_ms=10`);
  check(res, { "status 200": (r) => r.status === 200 });
  errorRate.add(res.status !== 200);
  // No sleep -- maximize CPU pressure
}
