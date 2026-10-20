const { buildEnumerateAll, parseEnumerateResponse } = require('./protocol/haCommand');
const { macToString } = require('./protocol/haCommandHeader');

// Confirmed discovery flow (see tools/decode-capture.js output): broadcast COMMAND.JOIN /
// ENUMERATE_ALL, collect every device's COMMAND.JOIN / ENUMERATE_RESPONSE reply for a short
// window. Each device replies from its own IP with its own MAC as sourceMAC and the model/firmware
// string as payload.
// UDP broadcast on WiFi drops packets routinely (the capture showed the real app retrying its
// own broadcast 2-4 times over ~3 seconds for exactly this reason) — send several broadcasts
// spaced out, and listen for the whole window, rather than relying on one shot.
function scanForDevices({ transport, timeoutMs = 4000, retries = 4, retryIntervalMs = 700 }) {
  const devices = new Map(); // mac string -> { mac, ip, model, firmwareVersion }

  const stopListening = transport.onMessage((decoded, rinfo) => {
    const parsed = parseEnumerateResponse(decoded);
    if (!parsed) return;
    const mac = macToString(decoded.sourceMAC);
    devices.set(mac, { mac, ip: rinfo.address, ...parsed });
  });

  const sendOnce = () => transport.sendBroadcast(buildEnumerateAll({ transport }));

  return (async () => {
    try {
      for (let i = 0; i < retries; i++) {
        await sendOnce();
        if (i < retries - 1) await new Promise((r) => setTimeout(r, retryIntervalMs));
      }
      await new Promise((r) => setTimeout(r, timeoutMs));
      return Array.from(devices.values());
    } finally {
      stopListening();
    }
  })();
}

module.exports = { scanForDevices };
