// Loaded only in the disposable candidate process, never in production code.
const net = require("node:net");
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const options = normalized[0];
  const host =
    typeof options === "object"
      ? options.host
      : typeof normalized[1] === "string"
        ? normalized[1]
        : "localhost";
  if (host && !["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error("SMOKE_NONLOCAL_NETWORK_DENIED");
  }
  return originalConnect.apply(this, args);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = function (input, options) {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("SMOKE_NONLOCAL_FETCH_DENIED");
  }
  return originalFetch(input, options);
};
console.log(
  `SMOKE_NODE_CHILD version=${process.version} execPath=${process.execPath} pid=${process.pid}`,
);
