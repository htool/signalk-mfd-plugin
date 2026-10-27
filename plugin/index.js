const id = "signalk-mfd-plugin";
const debug = require("debug")(id);
const {
  MULTICAST_GROUP_IP,
  PUBLISH_PORT,
  buildPublishMessage,
  buildTargets,
  createPublisher,
  listIPv4Interfaces,
  resolveTileInterfaces,
} = require("./lib");

// For debugging you can use
//   tcpdump -i wlan0 -A -v udp and dst net 239.2.1.1 and port 2053

var plugin = {};
var intervalid;

module.exports = function (app, options) {
  "use strict";
  var plugin = {};
  plugin.id = id;
  plugin.name = "B&G/Navico MFD WebApp tiles";
  plugin.description =
    "Signal K plugin to add webapp tiles to B&G/Navico MFDs over Ethernet or Wi-Fi";

  var unsubscribes = [];

  var schema = {
    type: "object",
    title: "B&G/Navico MFD WebApp tiles",
    description:
      "Each tile requires a unique IP on the local network. The README " +
      "(https://github.com/htool/signalk-mfd-plugin/blob/main/README.md) has " +
      "more info, including Wi-Fi setup.",
    properties: {
      tiles: {
        type: "array",
        title: "WebApp tiles",
        items: {
          type: "object",
          properties: {
            Source: {
              type: "string",
              title: "Source",
              default: "SignalK",
            },
            IP: {
              type: "string",
              title: "IP address",
              default: "192.168.x.x",
            },
            FeatureName: {
              type: "string",
              title: "Feature name",
              default: "Signal K webapps",
            },
            Name: {
              type: "string",
              title: "Name",
              default: "Signal K Name",
            },
            Description: {
              type: "string",
              title: "Description",
              default: "Signal K Description",
            },
            MenuText: {
              type: "string",
              title: "Menu Text",
              default: "Signal K Menu Text",
            },
            Icon: {
              type: "string",
              title: "WebApp tile image url",
              default:
                "http://192.168.x.x:3000/signalk-mfd-plugin/Logo-SignalK-navico.png",
            },
            URL: {
              type: "string",
              title: "WebApp url",
              default: "http://192.168.x.x:3000/admin/#/webapps",
            },
          },
        },
      },
      multicast: {
        type: "boolean",
        title: "Send multicast to 239.2.1.1 (standard Navico discovery)",
        default: true,
      },
      broadcast: {
        type: "boolean",
        title: "Also send a subnet broadcast (recommended on Wi-Fi)",
        default: true,
      },
      mfdAddresses: {
        type: "string",
        title: "Unicast to MFD IPs (comma separated, optional)",
        description:
          "Most reliable over Wi-Fi: send the announcement directly to the " +
          "MFD address(es). Leave empty to rely on multicast/broadcast.",
        default: "",
      },
      wifiOnly: {
        type: "boolean",
        title: "Only publish on Wi-Fi interfaces",
        default: false,
      },
      interfaceName: {
        type: "string",
        title: "Restrict to one interface (optional, e.g. wlan0)",
        default: "",
      },
      port: {
        type: "integer",
        title: "UDP port",
        default: PUBLISH_PORT,
      },
      ttl: {
        type: "integer",
        title: "Multicast TTL",
        default: 2,
      },
      intervalSeconds: {
        type: "integer",
        title: "Announcement interval (seconds)",
        default: 10,
      },
    },
  };

  plugin.schema = function () {
    return schema;
  };

  plugin.start = function (options) {
    var settings = options || {};
    var tiles = Array.isArray(settings.tiles) ? settings.tiles : [];
    var network = {
      multicast: settings.multicast !== false,
      broadcast: settings.broadcast !== false,
      mfdAddresses: settings.mfdAddresses || "",
      wifiOnly: settings.wifiOnly === true,
      interfaceName: String(settings.interfaceName || "").trim(),
      port: Number(settings.port) > 0 ? Number(settings.port) : PUBLISH_PORT,
      ttl: Number(settings.ttl) > 0 ? Number(settings.ttl) : 2,
      intervalSeconds:
        Number(settings.intervalSeconds) >= 2
          ? Number(settings.intervalSeconds)
          : 10,
    };

    app.debug("Starting plugin");
    app.debug("Options: %j", JSON.stringify(settings));

    var publisher = createPublisher({ log: (message) => app.debug(message) });
    var announced = new Set();
    var stopped = false;
    var publishing = false;
    var lastInterfaceSignature = "";

    function warnOnce(key, message) {
      if (announced.has(key)) return;
      announced.add(key);
      if (typeof app.error === "function") app.error(message);
      else app.debug(message);
    }

    function interfaces() {
      var list = listIPv4Interfaces();
      var signature = list
        .map(function (iface) {
          return iface.name + ":" + iface.address;
        })
        .join(",");
      if (signature !== lastInterfaceSignature) {
        lastInterfaceSignature = signature;
        if (!list.length) {
          app.debug("No usable IPv4 interfaces found");
        } else {
          app.debug(
            "IPv4 interfaces: %j",
            list.map(function (iface) {
              return (
                iface.name + " " + iface.address + (iface.wifi ? " (wifi)" : "")
              );
            })
          );
        }
      }
      return list;
    }

    async function publishOnce() {
      if (stopped || publishing) return;
      publishing = true;
      try {
        var resolved = resolveTileInterfaces(interfaces(), tiles, network);

        for (var i = 0; i < resolved.length; i++) {
          var entry = resolved[i];
          if (!entry.iface) {
            warnOnce(
              "tile:" + i + ":" + (entry.tile && entry.tile.IP),
              "Skipping tile " + (i + 1) + ": " + entry.reason
            );
            continue;
          }

          var buffer = Buffer.from(buildPublishMessage(entry.tile), "utf8");
          var targets = buildTargets(entry.iface, network);
          if (!targets.length) {
            warnOnce("targets:" + i, "No transports enabled; nothing to publish");
            continue;
          }

          for (var t = 0; t < targets.length; t++) {
            var target = targets[t];
            try {
              await publisher.send(buffer, entry.iface, target, {
                ttl: network.ttl,
                sourcePort: network.port,
              });
              debug(
                "%s => %s @%d (%s) %s",
                entry.iface.address,
                target.address,
                target.port,
                target.kind,
                buffer.toString()
              );
            } catch (error) {
              warnOnce(
                "send:" + entry.iface.address + ":" + target.address,
                "Cannot send to " +
                  target.address +
                  ":" +
                  target.port +
                  " - " +
                  error.message
              );
            }
          }
        }
      } finally {
        publishing = false;
      }
    }

    if (!tiles.length) {
      app.debug("No tiles configured yet");
    } else {
      app.debug(
        "Publishing %d tile(s) every %ds via %s%s%s",
        tiles.length,
        network.intervalSeconds,
        network.multicast ? "multicast" : "",
        network.broadcast ? " + broadcast" : "",
        network.mfdAddresses ? " + unicast" : ""
      );
      publishOnce();
    }

    intervalid = setInterval(publishOnce, network.intervalSeconds * 1000);

    plugin.stop = function () {
      stopped = true;
      clearInterval(intervalid);
      publisher.close();
      unsubscribes.forEach(function (fn) {
        fn();
      });
      unsubscribes = [];
      app.debug("Stopped");
    };
  };

  return plugin;
};

module.exports.app = "app";
module.exports.options = "options";
