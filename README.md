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
``$ sudo ip addr add 192.168.1.3/24 dev eth0`` where 192.168.1.3 is the IP to add and eth0 the interface to add it to.

A link on how to make this permanent for different Raspbian versions would be good here.

