import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost";

export const options = {
  scenarios: {
    memory_pressure: {
      executor: "per-vu-iterations",
      vus: 5,
      iterations: 20,
      maxDuration: "2m",
    },
  },
};

export default function () {
  // Allocate 5MB on Go API each iteration
  const res = http.get(`${BASE_URL}/api/allocate?mb=5`);
  check(res, {
    "allocate succeeded": (r) => r.status === 200,
    "not OOMKilled yet": (r) => r.status !== 502,
  });
  console.log(`Go allocate: status=${res.status}, body=${res.body}`);

  sleep(1);
}
