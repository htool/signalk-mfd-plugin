# SignalK plugin to add WebApp tiles to a B&G/Navico MFD

App Store installs come from npm. A GitHub Action patch-bumps and publishes at most once per UTC day when `plugin/` changed (`.github/workflows/release.yml`, npm trusted publishing). The tiles themselves are URLs into other plugins; those webapps must use Signal K 2.x readonly `GET /signalk/v1/api/<pluginId>/...` because `/plugins/` is admin-only.

This plugin allows you to add WebApps to your MFD. Possible use cases are:
 - [NavTex messages](https://www.npmjs.com/package/signalk-navtex-plugin)
 - [SailTrim](https://www.npmjs.com/package/signalk-trim-plugin)

## HTML5
There's quite some restriction on what works. It needs to be quite strict HTML5. Keyboard interaction (keys) doesn't work.

## Screenshot
![Screenshot of Vulcan 12"](https://raw.githubusercontent.com/htool/signalk-mfd-plugin/main/images/tiles.png)

## Ethernet or Wi-Fi

Tiles are announced over UDP to `239.2.1.1:2053`. The plugin works on a wired
Navico Ethernet network **and** on Wi-Fi:

* every IPv4 interface is inspected and each tile is sent from the interface
  that owns its IP (`eth0`, `wlan0`, `wlp*`, `en0`, Windows "Wi-Fi", …);
* multicast is pinned to that interface (`setMulticastInterface`), so a tile on
  `wlan0` is not sent through `eth0` when both are connected;
* subnet broadcast is enabled by default, and announcements can also be sent by
  unicast to MFD addresses. Both help on access points that drop or snoop
  multicast;
* announcements are published immediately on start and the socket is rebuilt
  after a Wi-Fi reconnect.

Some MFD firmware only consumes tile announcements on its wired Navico Ethernet
interface. In that case the MFD will not show tiles sent over Wi-Fi regardless
of this plugin. If the tile appears but the page stays blank, check that the MFD
can reach the tile URL (same subnet, no client isolation).

### Network options

| Option | Default | Meaning |
| --- | --- | --- |
| Multicast to 239.2.1.1 | on | Standard Navico discovery packet |
| Subnet broadcast | on | Also send to `<subnet>.255:2053`; helps on Wi-Fi |
| Unicast to MFD IPs | empty | Comma-separated MFD addresses; most reliable over Wi-Fi |
| Only publish on Wi-Fi | off | Ignore Ethernet interfaces |
| Restrict to one interface | empty | For example `wlan0` or `wlp3s0` |
| UDP port | 2053 | Source and destination port |
| Multicast TTL | 2 | Increase if multicast is routed between VLANs |
| Interval | 10 s | Announcement period (minimum 2 s) |

## IP addresses
Because these tiles typically represent hardware on the ethernet network, each tile is expected to have a unique IP address.
If you want to add multiple WebApps from SignalK you can add virtual IPs to your interface like this:
`$ sudo ip addr add 192.168.1.3/24 dev eth0` where `192.168.1.3` is the IP to add and eth0 the interface to add it to.

Use the interface that reaches the MFD. On Wi-Fi that is usually `wlan0`:

```
$ sudo ip addr add 192.168.1.11/24 dev wlan0
$ sudo ip addr add 192.168.1.12/24 dev wlan0
```

Prefer a static address or a DHCP reservation so the tiles keep working after a
reboot. SignalK needs to be restarted to make SignalK bind to the ports on the
newly added IPs.

A link on how to make this permanent for different Raspbian versions would be good here.

One solutions (I know, a bit clumsy) is:

Add a crontab entry for root:
```
@reboot /root/bin/addIPs.sh
```

And then have a file `/root/bin/addIPs.sh` with:
```
#!/bin/bash
export PATH=$PATH:/usr/sbin/:/usr/bin
sleep 60
# Additional IPs for SignalK WebApps
ip addr add 192.168.3.10/24 dev eth0
ip addr add 192.168.3.11/24 dev eth0
ip addr add 192.168.3.12/24 dev eth0
ip addr add 192.168.3.13/24 dev eth0

# Restart SignalK to pick bind to newly added IPs
systemctl restart signalk
```

## Wi-Fi checklist

1. The MFD and Signal K are in the same subnet and can reach each other.
2. Client/AP isolation is disabled on the access point.
3. IGMP snooping (or multicast-to-unicast conversion) is enabled if available.
4. UDP 2053 and the web-app TCP port (usually 3000) are allowed.
5. If tiles still do not appear, add the MFD IP to *Unicast to MFD IPs*; this
   bypasses multicast entirely.

Verify that packets leave the host:

```
sudo tcpdump -i wlan0 -A -v udp and dst net 239.2.1.1 and port 2053
```

And enable plugin debug logging:

```
DEBUG=signalk-mfd-plugin signalk-server
```

## Tests

The network helpers and the publish loop have tests that use only Node's
built-in test runner and real UDP sockets:

```
npm install
npm test
```

Set `SKIP_MULTICAST_TEST=1` when running on a host without multicast support.
