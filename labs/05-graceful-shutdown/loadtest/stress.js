import http from "k6/http";
import { check } from "k6";
import { Rate, Counter } from "k6/metrics";

const errorRate = new Rate("errors");
const errorCount = new Counter("error_count");
const BASE_URL = __ENV.BASE_URL || "http://localhost";

export const options = {
  scenarios: {
    constant_load: {
      executor: "constant-vus",
      vus: 20,
      duration: "3m",
    },
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/api/work?duration_ms=100`);
  const success = check(res, {
    "status 200": (r) => r.status === 200,
    "no connection error": (r) => r.error === "",
  });
  if (!success) {
    errorRate.add(1);
    errorCount.add(1);
    console.log(`ERROR: status=${res.status} error=${res.error}`);
  } else {
    errorRate.add(0);
  }
}
