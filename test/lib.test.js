"use strict";

const assert = require("node:assert/strict");
const dgram = require("node:dgram");
const test = require("node:test");

const {
  MULTICAST_GROUP_IP,
  broadcastAddress,
  buildPublishMessage,
  buildTargets,
  createPublisher,
  isIPv4Address,
  isWifiInterface,
  listIPv4Interfaces,
  parseAddressList,
  resolveTileInterfaces,
} = require("../plugin/lib");

const wifiIface = {
  name: "wlan0",
  address: "192.168.1.10",
  netmask: "255.255.255.0",
  mac: "aa:bb:cc:dd:ee:ff",
  wifi: true,
};
const ethIface = {
  name: "eth0",
  address: "192.168.1.20",
  netmask: "255.255.255.0",
  mac: "aa:bb:cc:dd:ee:00",
  wifi: false,
};

function onceMessage(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeListener("message", onMessage);
      reject(new Error("timed out waiting for a datagram"));
    }, timeoutMs);
    function onMessage(message, remote) {
      clearTimeout(timer);
      socket.removeListener("message", onMessage);
      resolve({ message: message.toString(), remote });
    }
    socket.once("message", onMessage);
  });
}

test("broadcastAddress honours the netmask", () => {
  assert.equal(broadcastAddress("192.168.1.10", "255.255.255.0"), "192.168.1.255");
  assert.equal(broadcastAddress("10.1.2.3", "255.255.0.0"), "10.1.255.255");
  assert.equal(broadcastAddress("172.16.5.4", "255.255.252.0"), "172.16.7.255");
  assert.equal(broadcastAddress("nope", "255.255.255.0"), null);
});

test("parseAddressList accepts commas, spaces and arrays", () => {
  assert.deepEqual(parseAddressList("192.168.1.50, 192.168.1.51"), [
    "192.168.1.50",
    "192.168.1.51",
  ]);
  assert.deepEqual(parseAddressList("192.168.1.50\n192.168.1.51"), [
    "192.168.1.50",
    "192.168.1.51",
  ]);
  assert.deepEqual(parseAddressList([" 10.0.0.2 "]), ["10.0.0.2"]);
  assert.deepEqual(parseAddressList(""), []);
});

test("isIPv4Address rejects placeholders", () => {
  assert.equal(isIPv4Address("192.168.1.10"), true);
  assert.equal(isIPv4Address("192.168.x.x"), false);
  assert.equal(isIPv4Address("0.0.0.0"), true);
  assert.equal(isIPv4Address("999.1.1.1"), false);
  assert.equal(isIPv4Address("wlan0"), false);
});

test("isWifiInterface recognises common names and sysfs", () => {
  assert.equal(isWifiInterface("wlan0"), true);
  assert.equal(isWifiInterface("wlp3s0"), true);
  assert.equal(isWifiInterface("wlx001122334455"), true);
  assert.equal(isWifiInterface("Wi-Fi"), true);
  assert.equal(isWifiInterface("wireless_0"), true);
  assert.equal(isWifiInterface("eth0"), false);
  assert.equal(isWifiInterface("en0"), false);
});

test("listIPv4Interfaces keeps usable addresses only", () => {
  const interfaces = listIPv4Interfaces({
    lo: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", internal: true }],
    wlan0: [
      { address: "192.168.1.10", netmask: "255.255.255.0", family: "IPv4", internal: false },
      { address: "fe80::1", netmask: "ffff:ffff:ffff:ffff::", family: "IPv6", internal: false },
    ],
    eth0: [
      { address: "169.254.3.4", netmask: "255.255.0.0", family: 4, internal: false },
      { address: "10.0.0.5", netmask: "255.255.255.0", family: 4, internal: false },
    ],
  });
  assert.equal(interfaces.length, 2);
  assert.ok(interfaces.some((entry) => entry.address === "192.168.1.10" && entry.wifi));
  assert.ok(interfaces.some((entry) => entry.address === "10.0.0.5" && !entry.wifi));
});

test("resolveTileInterfaces matches tiles to local addresses", () => {
  const resolved = resolveTileInterfaces(
    [wifiIface, ethIface],
    [{ IP: "192.168.1.10" }, { IP: "192.168.1.99" }, { IP: "192.168.x.x" }]
  );
  assert.equal(resolved[0].iface, wifiIface);
  assert.equal(resolved[1].iface, null);
  assert.match(resolved[1].reason, /not configured on this host/);
  assert.equal(resolved[2].iface, null);
  assert.match(resolved[2].reason, /not a valid IPv4/);
});

test("resolveTileInterfaces honours wifiOnly and interfaceName", () => {
  const wifiOnly = resolveTileInterfaces([wifiIface, ethIface], [{ IP: "192.168.1.20" }], {
    wifiOnly: true,
  });
  assert.equal(wifiOnly[0].iface, null);
  assert.match(wifiOnly[0].reason, /excluded/);

  const named = resolveTileInterfaces([wifiIface, ethIface], [{ IP: "192.168.1.10" }], {
    interfaceName: "eth0",
  });
  assert.equal(named[0].iface, null);

  const allowed = resolveTileInterfaces([wifiIface], [{ IP: "192.168.1.10" }], {
    wifiOnly: true,
  });
  assert.equal(allowed[0].iface, wifiIface);
});

test("buildTargets adds multicast, broadcast and unicast destinations", () => {
  const targets = buildTargets(wifiIface, {
    port: 2053,
    broadcast: true,
    mfdAddresses: "192.168.1.50, 192.168.1.51",
  });
  assert.deepEqual(
    targets.map((target) => `${target.kind}:${target.address}:${target.port}`),
    [
      `multicast:${MULTICAST_GROUP_IP}:2053`,
      "broadcast:192.168.1.255:2053",
      "unicast:192.168.1.50:2053",
      "unicast:192.168.1.51:2053",
    ]
  );
});

test("buildTargets can disable multicast and deduplicates", () => {
  const targets = buildTargets(wifiIface, {
    multicast: false,
    broadcast: false,
    mfdAddresses: "192.168.1.50,192.168.1.50",
  });
  assert.deepEqual(
    targets.map((target) => target.address),
    ["192.168.1.50"]
  );
});

test("buildPublishMessage keeps the Navico schema and fixes MenuText", () => {
  const json = buildPublishMessage({
    Source: "SignalK",
    IP: "192.168.1.10",
    FeatureName: "Signal K webapps",
    Name: "Instruments",
    Description: "Main dashboard",
    Icon: "http://192.168.1.10:3000/icon.png",
    URL: "http://192.168.1.10:3000/",
  });
  const message = JSON.parse(json);
  assert.equal(message.Version, "1");
  assert.equal(message.Source, "SignalK");
  assert.equal(message.IP, "192.168.1.10");
  assert.equal(message.FeatureName, "Signal K webapps");
  assert.deepEqual(message.Text, [
    { Language: "en", Name: "Instruments", Description: "Main dashboard" },
  ]);
  assert.equal(message.OnlyShowOnClientIP, "true");
  assert.equal(message.BrowserPanel.Enable, true);
  assert.deepEqual(message.BrowserPanel.MenuText, [
    { Language: "en", Name: "Main dashboard" },
  ]);

  const withMenu = JSON.parse(
    buildPublishMessage({ IP: "192.168.1.10", Name: "X", MenuText: "Open X" })
  );
  assert.equal(withMenu.BrowserPanel.MenuText[0].Name, "Open X");
});

test("publisher sends a datagram to a unicast target", async () => {
  const receiver = dgram.createSocket("udp4");
  await new Promise((resolve) => receiver.bind(0, "127.0.0.1", resolve));
  const port = receiver.address().port;
  const publisher = createPublisher({ sourcePort: 0 });
  try {
    const waiting = onceMessage(receiver, 3000);
    await publisher.send(
      Buffer.from("hello-mfd"),
      { address: "127.0.0.1", netmask: "255.0.0.0", name: "lo", wifi: false },
      { address: "127.0.0.1", port, kind: "unicast" },
      { ttl: 1, sourcePort: 0 }
    );
    const received = await waiting;
    assert.equal(received.message, "hello-mfd");
  } finally {
    publisher.close();
    receiver.close();
  }
});

test(
  "publisher sends a multicast announcement on the selected interface",
  { skip: process.env.SKIP_MULTICAST_TEST === "1" },
  async () => {
    const iface = listIPv4Interfaces().find((entry) => entry.wifi) ||
      listIPv4Interfaces()[0];
    assert.ok(iface, "no usable IPv4 interface on this host");

    const receiver = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const publisher = createPublisher({ sourcePort: 0 });
    try {
      await new Promise((resolve) =>
        receiver.bind({ port: 22053, address: "0.0.0.0", exclusive: false }, resolve)
      );
      receiver.addMembership(MULTICAST_GROUP_IP, iface.address);
      const waiting = onceMessage(receiver, 4000);
      await publisher.send(
        Buffer.from("multicast-mfd"),
        iface,
        { address: MULTICAST_GROUP_IP, port: 22053, kind: "multicast" },
        { ttl: 2, sourcePort: 0 }
      );
      const received = await waiting;
      assert.equal(received.message, "multicast-mfd");
    } finally {
      publisher.close();
      receiver.close();
    }
  }
);
