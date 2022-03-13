const id = "signalk-mfd-plugin";
const dgram_1 = __importDefault(require("dgram"));
const os = require("os");
const debug = require('debug')(id)
const PUBLISH_PORT = 2053;
const MULTICAST_GROUP_IP = '239.2.1.1';

// For debugging you can use
// tcpdump -i en0 -A  -v net 239.2.1.1

var plugin = {}
var intervalid;

module.exports = function(app, options) {
  "use strict"
  var plugin = {}
  plugin.id = id
  plugin.name = "B&G/Navico MFD WebApp tiles"
  plugin.description = "Signal K plugin to add webapp tiles to B&G/Navico MFDs"

  var unsubscribes = []

  var schema = {
    type: "object",
    title: "B&G/Navico MFD WebApp tiles",
    description: 
    "Each tile requires a unique IP on the local network. The README (https://github.com/htool/signalk-mfd-plugin/blob/main/README.md) has more info on this.",
    properties: {
      tiles: {
        type: "array",
        title: "WebApp tiles",
	      items: {
	        type: 'object',
	        properties: {
	          Source: {
	            type: 'string',
	            title: 'Source',
	            default: 'SignalK'
	          },
	          IP: {
	            type: 'string',
	            title: 'IP address',
	            default: '192.168.x.x'
	          },
	          FeatureName: {
	            type: 'string',
	            title: 'Feature name',
	            default: 'Signal K webapps'
	          },
	          Name: {
	            type: 'string',
	            title: 'Name',
	            default: 'Signal K Name'
	          },
	          Description: {
	            type: 'string',
	            title: 'Description',
	            default: 'Signal K Description'
	          },
            Icon: {
              type: 'string',
			        title: 'WebApp tile image url',
	            default: 'http://192.168.x.x:3000/signalk-mfd-plugin/Logo-SignalK-navico.png',
			      },
            URL: {
              type: 'string',
			        title: 'WebApp url',
	            default: 'http://192.168.x.x:3000/admin/#/webapps',
			      },
	          Description: {
	            type: 'string',
	            title: 'Menu Text',
	            default: 'Signal K Menu Text'
	          }
			    }
			  }
      }
    }
  } 

  plugin.schema = function() {
    return schema
  }

  plugin.start = function(options, restartPlugin) {
    var text = [];
    app.debug('Starting plugin');
    app.debug('Options: %j', JSON.stringify(options));
	  intervalid = setInterval(() => publishToNavico(), 10 * 1000);

		const getPublishMessage = (tile) => {
      // Options: "{\"tiles\":[{\"Source\":\"SignalK\",\"IP\":\"127.0.0.4\",\"FeatureName\":\"Signal K webapps\",\"Name\":\"Signal K Name\",\"Description\":\"Signal K Menu Text\",\"Icon\":\"http://127.0.0.4/admin/img/signal-k-logo-image-text.svg\",\"URL\":\"http://127.0.0.4:3000/admin/#/webapps\"}]}"
			return JSON.stringify({
			  Version: '1',
			  Source: tile['Source'],
			  IP: tile['IP'],
			  FeatureName: tile['FeatureName'],
			  Text: [
			    {
			      Language: 'en',
			      Name: tile['Name'],
			      Description: tile['Description']
			    }
			  ],
			  Icon: tile['Icon'],
			  URL: tile['URL'],
			  OnlyShowOnClientIP: 'true',
			  BrowserPanel: {
			    Enable: true,
			    ProgressBarEnable: true,
			    MenuText: [
			      {
			        Language: 'en',
			        Name: tile['MenuText'],
			      }
			    ]
			  }
			});
		}

		const send = (msg, fromAddress, toAddress, port) => {
			const socket = dgram_1.default.createSocket('udp4');
			socket.once('listening', () => {
			  socket.send(msg, port, toAddress, () => {
			    socket.close();
			    debug(`${fromAddress}=>${toAddress} @${port} ${msg}`);
			  });
			});
			socket.bind(PUBLISH_PORT, fromAddress);
		}

		const publishToNavico = () => {
			for (const [name, infos] of Object.entries(os.networkInterfaces())) {
			  for (const addressInfo of infos || []) {
          options['tiles'].forEach((tile) => {
            if (addressInfo.address == tile['IP']) {
              app.debug('tile: %j', JSON.stringify(tile));
			        send(getPublishMessage(tile), addressInfo.address, MULTICAST_GROUP_IP, PUBLISH_PORT);
            }
          });
			  }
			}
		}

  }

  plugin.stop = function() {
    app.debug("Stopping")
    unsubscribes.forEach(f => f());
    unsubscribes = [];
    clearInterval(intervalid);
    app.debug("Stopped")
  }

  return plugin;
};

module.exports.app = "app"
module.exports.options = "options"
