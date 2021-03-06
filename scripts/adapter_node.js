#!/usr/bin/env node

const rosnodejs = require('rosnodejs');
const Pusher = require('pusher-js');


const appKey = 'fa20e14745781ba145ef';
const cluster = 'eu';
const authEndpoint =
	'https://us-central1-harveynet-dcfee.cloudfunctions.net/pusherAuthMachine';

const machineId = 'machine1';		// authorize as "machine1"


// pusher message chunking (copy-pasted)
function triggerChunked(channel, event, data) {
  const chunkSize = 9999;
  const str = JSON.stringify(data);
  const msgId = Math.random() + '';
  for (var i = 0; i*chunkSize < str.length; i++) {
    // TODO: use pusher.triggerBatch for better performance
    channel.trigger(event + '-chunked', { 
      id: msgId, 
      index: i, 
      chunk: str.substr(i*chunkSize, chunkSize), 
      final: chunkSize*(i+1) >= str.length
    });
  }
}


// init pusher & presence channel
const pusher = new Pusher(appKey, {
	cluster,
	authEndpoint,
	auth: {
		params: { machineId },
	},
});
const channelName = `presence-${machineId}`;
const channel = pusher.subscribe(channelName);


// init adapter node
rosnodejs.initNode('/adapter')
	.then(() => {		
		const odomInterval = 1000;
		let odomTriggerAllowed = true;
		setInterval(() => {
			odomTriggerAllowed = true;
		}, odomInterval);
		const nh = rosnodejs.nh;
		// odometry
		const sub = nh.subscribe('/odom', 'nav_msgs/Odometry', msg => {
			const { x, y } = msg.pose.pose.position; 
			console.log(`x: ${x}, y: ${y}`);
			if (odomTriggerAllowed) {
				channel.trigger('client-set-coordinates', { x, y });
				odomTriggerAllowed = false;
			}
		});
		// camera image
		const cameraTriggerInterval = 200;
		let cameraTriggerAllowed = true;
		setInterval(() => {
			cameraTriggerAllowed = true;
		}, cameraTriggerInterval);
		const sub2 = nh.subscribe(
			'/camera/rgb/image_raw/compressed',
			'sensor_msgs/CompressedImage',
			msg => {
				if (cameraTriggerAllowed) {
					const _image = Buffer.from(msg.data).toString('base64');
					const image = 'data:image/jpg;base64,' + _image;
					triggerChunked(channel, 'client-set-camera-image', { image });
					cameraTriggerAllowed = false;
				}
			},
		);

		const linearSpeed = 0.5;
		const angularSpeed = 1;
		const commandObj = {
			lx: 0,
			az: 0,
		}
		channel.bind('client-move-command', command => {
			const { l, a } = command;
			commandObj.lx = l * linearSpeed;
			commandObj.az = a * angularSpeed;
		});

		const pub = nh.advertise('/cmd_vel_mux/input/teleop', 'geometry_msgs/Twist');
		setInterval(() => {
			const { lx, az } = commandObj;		
			const msg = {
				linear: { x: lx, y: 0, z: 0 },
				angular: { x: 0, y: 0, z: az },
			};
			pub.publish(msg);
		}, 10);
	});
