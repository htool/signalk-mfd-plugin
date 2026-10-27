"use strict";

/**
 * Network helpers and the UDP publisher used by the Signal K MFD tile plugin.
 *
 * Everything here is deliberately independent of Signal K so it can be tested
 * with plain Node (`node --test`).
 */

const dgram = require("dgram");
const fs = require("fs");
const os = require("os");

const MULTICAST_GROUP_IP = "239.2.1.1";
const PUBLISH_PORT = 2053;

/** Navico announces MFD web-app tiles on this group/port. */
const ANNOUNCE_TARGET = Object.freeze({
  address: MULTICAST_GROUP_IP,
  port: PUBLISH_PORT,
  kind: "multicast",
});

function isIPv4(info) {
  return info && (info.family === "IPv4" || info.family === 4);
}

/**
 * True for interfaces that look like Wi-Fi.
 *
 * Handles Linux (`wlan0`, `wlp3s0`, `wlx...`), macOS (`en0` is usually Wi-Fi,
 * but is not assumed), Windows adapter names and the Linux sysfs marker.
 */
function isWifiInterface(name) {
  if (!name) return false;
  const value = String(name).toLowerCase();
  if (/^(wl|wlan|wifi|wi-fi|wireless)/.test(value)) return true;
  if (value.includes("wi-fi") || value.includes("wifi") || value.includes("wireless")) {
    return true;
  }
  if (darwinWifiDevices().has(name)) return true;
  try {
    return fs.existsSync(`/sys/class/net/${name}/wireless`);
  } catch (_error) {
    return false;
  }
}

let cachedDarwinWifiDevices = null;

/** macOS reports Wi-Fi as en0/en1; map it through networksetup. */
function darwinWifiDevices() {
  if (os.platform() !== "darwin") return new Set();
  if (cachedDarwinWifiDevices) return cachedDarwinWifiDevices;
  cachedDarwinWifiDevices = new Set();
  try {
    const { execFileSync } = require("child_process");
    const text = execFileSync("networksetup", ["-listallhardwareports"], {
      encoding: "utf8",
    });
    for (const block of text.split(/\n\s*\n/)) {
      if (!/Wi-?Fi/i.test(block)) continue;
      const match = block.match(/Device:\s*(\S+)/);
      if (match) cachedDarwinWifiDevices.add(match[1]);
    }
  } catch (_error) {
    // networksetup is macOS-only; ignore failures.
  }
  return cachedDarwinWifiDevices;
}

/**
 * Returns usable IPv4 addresses.
 *
 * `interfaces` can be injected for tests; it defaults to `os.networkInterfaces()`.
 */
function listIPv4Interfaces(interfaces = os.networkInterfaces()) {
  const result = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const info of entries || []) {
      if (!isIPv4(info) || info.internal) continue;
      const address = String(info.address || "");
      if (!address || address.startsWith("169.254.")) continue; // link-local
      result.push({
        name,
        address,
        netmask: info.netmask || "255.255.255.0",
        mac: info.mac || "",
        wifi: isWifiInterface(name),
      });
    }
  }
  return result;
}

function ipToInt(address) {
  const parts = String(address).split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = (value << 8) | octet;
  }
  return value >>> 0;
}

function isIPv4Address(address) {
  return ipToInt(address) !== null;
}

function intToIp(value) {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join(".");
}

/** Subnet-directed broadcast address for an IPv4 address/netmask pair. */
function broadcastAddress(address, netmask) {
  const host = ipToInt(address);
  const mask = ipToInt(netmask);
  if (host === null || mask === null) return null;
  return intToIp(((host & mask) | (~mask >>> 0)) >>> 0);
}

/** Accepts "a, b\nc", an array, or undefined. */
function parseAddressList(value) {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  return String(value)
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function interfaceAllowed(iface, options = {}) {
  if (options.interfaceName) return iface.name === options.interfaceName;
  if (options.wifiOnly) return iface.wifi === true;
  return true;
}

/**
 * Matches every tile to the local interface that owns its IP.
 *
 * The MFD uses the tile IP both as the announcement source and as the web-app
 * URL host, so a tile can only be published from an address that exists on this
 * host.
 */
function resolveTileInterfaces(interfaces, tiles, options = {}) {
  const byAddress = new Map();
  for (const iface of interfaces) byAddress.set(iface.address, iface);

  return (tiles || []).map((tile) => {
    const ip = String((tile && tile.IP) || "").trim();
    if (!isIPv4Address(ip)) {
      return { tile, iface: null, reason: "tile IP is not a valid IPv4 address" };
    }
    const iface = byAddress.get(ip);
    if (!iface) {
      return {
        tile,
        iface: null,
        reason: `${ip} is not configured on this host (add it to the interface that reaches the MFD)`,
      };
    }
    if (!interfaceAllowed(iface, options)) {
      return {
        tile,
        iface: null,
        reason: `interface ${iface.name} (${iface.address}) is excluded by the plugin settings`,
      };
    }
    return { tile, iface, reason: null };
  });
}

/**
 * Builds the destination list for one interface.
 *
 * multicast: 239.2.1.1:port (the protocol's normal transport)
 * broadcast: <subnet>.255:port (helps APs that drop multicast)
 * unicast:   configured MFD addresses (most reliable over Wi-Fi)
 */
function buildTargets(iface, options = {}) {
  const port = Number(options.port) > 0 ? Number(options.port) : PUBLISH_PORT;
  const targets = [];
  const seen = new Set();

  const add = (address, kind) => {
    if (!address) return;
    const key = `${address}:${port}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ address, port, kind });
  };

  if (options.multicast !== false) add(MULTICAST_GROUP_IP, "multicast");
  if (options.broadcast) {
    add(broadcastAddress(iface.address, iface.netmask), "broadcast");
  }
  for (const address of parseAddressList(options.mfdAddresses)) {
    add(address, "unicast");
  }
  return targets;
}

/**
 * Builds the Navico announcement JSON for one tile.
 *
 * `MenuText` was referenced by the original code but never existed in its
 * schema; it now falls back to Description/Name for older configurations.
 */
function buildPublishMessage(tile) {
  const name = tile.Name || tile.FeatureName || "Signal K";
  const description = tile.Description || "";
  const menuText = tile.MenuText || tile.Description || name;
  return JSON.stringify({
    Version: "1",
    Source: tile.Source || "SignalK",
    IP: tile.IP,
    FeatureName: tile.FeatureName || name,
    Text: [
      {
        Language: "en",
        Name: name,
        Description: description,
      },
    ],
    Icon: tile.Icon,
    URL: tile.URL,
    OnlyShowOnClientIP: "true",
    BrowserPanel: {
      Enable: true,
      ProgressBarEnable: true,
      MenuText: [
        {
          Language: "en",
          Name: menuText,
        },
      ],
    },
  });
}

function bindSocket(dgramModule, address, port) {
  return new Promise((resolve, reject) => {
    const socket = dgramModule.createSocket({ type: "udp4", reuseAddr: true });
    const onError = (error) => {
      socket.removeListener("listening", onListening);
      try {
        socket.close();
      } catch (_closeError) {
        // Ignore: already closed by the runtime.
      }
      reject(error);
    };
    const onListening = () => {
      socket.removeListener("error", onError);
      resolve(socket);
    };
    socket.once("error", onError);
    socket.once("listening", onListening);
    socket.bind({ address, port, exclusive: false });
  });
}

/**
 * Socket pool + send helper.
 *
 * One socket per source address, bound to `sourcePort` when possible and to an
 * ephemeral port otherwise, so a stale listener on 2053 cannot stop publishing.
 */
function createPublisher({ log = () => {}, dgramModule = dgram, sourcePort = PUBLISH_PORT } = {}) {
  const sockets = new Map();
  const pending = new Map();
  let closed = false;

  async function createSocket(address, options = {}) {
    const requestedPort =
      options.sourcePort === undefined ? sourcePort : Number(options.sourcePort) || 0;
    let socket;
    let boundPort = requestedPort;
    try {
      socket = await bindSocket(dgramModule, address, requestedPort);
    } catch (error) {
      if (requestedPort === 0) throw error;
      log(`cannot bind ${address}:${requestedPort} (${error.message}); using an ephemeral port`);
      socket = await bindSocket(dgramModule, address, 0);
      boundPort = 0;
    }

    try {
      socket.setMulticastTTL(Number(options.ttl) > 0 ? Number(options.ttl) : 2);
    } catch (error) {
      log(`cannot set multicast TTL: ${error.message}`);
    }
    try {
      socket.setMulticastLoopback(true);
    } catch (_error) {
      // Not supported everywhere; harmless.
    }
    try {
      socket.setBroadcast(true);
    } catch (_error) {
      // Only needed for broadcast targets.
    }
    try {
      socket.setMulticastInterface(address);
    } catch (error) {
      log(`cannot select multicast interface ${address}: ${error.message}`);
    }
    socket.on("error", (error) => log(`socket ${address} error: ${error.message}`));
    sockets.set(address, socket);
    log(`publishing from ${address}:${boundPort === 0 ? "ephemeral" : boundPort}`);
    return socket;
  }

  async function getSocket(address, options = {}) {
    if (closed) throw new Error("publisher is closed");
    if (sockets.has(address)) return sockets.get(address);
    if (pending.has(address)) return pending.get(address);
    const promise = createSocket(address, options);
    pending.set(address, promise);
    try {
      return await promise;
    } finally {
      pending.delete(address);
    }
  }

  async function send(buffer, iface, target, options = {}) {
    const socket = await getSocket(iface.address, options);
    try {
      socket.setMulticastInterface(iface.address);
    } catch (_error) {
      // Interface may not be multicast-capable (e.g. some VPNs).
    }
    try {
      await new Promise((resolve, reject) => {
        socket.send(buffer, 0, buffer.length, target.port, target.address, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    } catch (error) {
      // A Wi-Fi reconnect invalidates the bound socket; rebuild it next time.
      dropSocket(iface.address);
      throw error;
    }
  }

  function dropSocket(address) {
    pending.delete(address);
    const socket = sockets.get(address);
    if (!socket) return;
    sockets.delete(address);
    try {
      socket.close();
    } catch (_error) {
      // Already closed.
    }
  }

  function close() {
    closed = true;
    for (const socket of sockets.values()) {
      try {
        socket.close();
      } catch (_error) {
        // Already closed.
      }
    }
    sockets.clear();
  }

  return { send, close };
}

module.exports = {
  ANNOUNCE_TARGET,
  MULTICAST_GROUP_IP,
  PUBLISH_PORT,
  broadcastAddress,
  buildPublishMessage,
  buildTargets,
  createPublisher,
  interfaceAllowed,
  isIPv4Address,
  isWifiInterface,
  listIPv4Interfaces,
  parseAddressList,
  resolveTileInterfaces,
};
