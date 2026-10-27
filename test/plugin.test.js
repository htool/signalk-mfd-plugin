"use strict";

const assert = require("node:assert/strict");
const dgram = require("node:dgram");
const test = require("node:test");

const pluginFactory = require("../plugin");
const { MULTICAST_GROUP_IP, listIPv4Interfaces } = require("../plugin/lib");

function onceMessage(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeListener("message", onMessage);
      reject(new Error("timed out waiting for a datagram"));
    }, timeoutMs);
    function onMessage(message) {
      clearTimeout(timer);
      socket.removeListener("message", onMessage);
      resolve(message.toString());
    }
    socket.once("message", onMessage);
  });
}

test("plugin.start publishes a tile and plugin.stop stops it", async () => {
  const iface = listIPv4Interfaces()[0];
  assert.ok(iface, "no usable IPv4 interface on this host");

  const port = 22054;
  const receiver = dgram.createSocket({ type: "udp4", reuseAddr: true });
  await new Promise((resolve) =>
    receiver.bind({ port, address: "0.0.0.0", exclusive: false }, resolve)
  );
  receiver.addMembership(MULTICAST_GROUP_IP, iface.address);

  const logs = [];
  const app = {
    debug: (...args) => logs.push(args.join(" ")),
    error: (...args) => logs.push(args.join(" ")),
  };
  const options = {
    tiles: [
      {
        Source: "SignalK",
        IP: iface.address,
        FeatureName: "Signal K webapps",
        Name: "Test tile",
        Description: "Published by the test suite",
        Icon: "http://example.invalid/icon.png",
        URL: "http://example.invalid/",
      },
    ],
    multicast: true,
    broadcast: false,
    port,
    intervalSeconds: 60,
  };

  const instance = pluginFactory(app, options);
  try {
    instance.start(options);
    const message = JSON.parse(await onceMessage(receiver, 4000));
    assert.equal(message.IP, iface.address);
    assert.equal(message.Text[0].Name, "Test tile");
    assert.equal(message.URL, "http://example.invalid/");
    assert.equal(instance.id, "signalk-mfd-plugin");
  } finally {
    instance.stop();
    receiver.close();
  }
});
