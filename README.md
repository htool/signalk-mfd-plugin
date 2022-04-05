# SignalK plugin to add WebApp tiles to a B&G/Navico MFD

This plugin allows you to add WebApps to your MFD. Possible use cases are:
 - [NavTex messages](https://www.npmjs.com/package/signalk-navtex-plugin)
 - [SailTrim](https://www.npmjs.com/package/signalk-trim-plugin)

## Ethernet required
WebApps will only appear on the MFD when it's connected through wired Ethernet.
You can read more on how to make an Ethernet connection [here](https://www.bandg.com/nl-nl/service/?guideTitle=original&guideId=003-795)

## IP addresses
Because these tiles typically represent hardware on the ethernet network, each tile is expected to have a unique IP address.
If you want to add multiple WebApps from SignalK you can add virtual IPs to your interface like this:
`$ sudo ip addr add 192.168.1.3/24 dev eth0` where `192.168.1.3` is the IP to add and eth0 the interface to add it to.

SignalK needs to be restarted to make SignalK bind to the ports on the newly added IPs.

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

