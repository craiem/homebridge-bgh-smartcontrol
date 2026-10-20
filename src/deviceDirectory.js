// Tracks the current best-known IP for each device MAC, kept fresh passively: every inbound
// HACommand packet (discovery reply, status broadcast, ACK — anything) carries both the sender's
// MAC and its real source IP, so the platform updates this on every received packet with no extra
// network traffic. This is what makes the plugin survive a DHCP lease change without needing a
// static IP reservation: config.json's `ip` is only ever a bootstrap value used until something
// fresher is heard from that MAC.
class DeviceDirectory {
  constructor() {
    this.ipByMac = new Map();
  }

  observe(macString, ip) {
    this.ipByMac.set(macString.toLowerCase(), ip);
  }

  resolve(macString, fallbackIp) {
    return this.ipByMac.get(macString.toLowerCase()) || fallbackIp;
  }
}

module.exports = { DeviceDirectory };
