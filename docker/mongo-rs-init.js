// Best-effort replica-set bootstrap for local compose.
// Healthcheck also initiates rs0 if this script races with mongod startup.
try {
  rs.status();
} catch (e) {
  rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongodb:27017" }] });
}
