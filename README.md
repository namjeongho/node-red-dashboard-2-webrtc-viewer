# node-red-dashboard-2-webrtc-viewer

WebRTC video viewer widget for Node-RED Dashboard 2.0.

Designed for viewing WebRTC/WHEP streams such as MediaMTX.

## Features

- WebRTC/WHEP playback
- Dynamic stream URL via `msg.payload`
- Dynamic stream name via `msg.topic`
- Automatic reconnection
- Configurable reconnect interval
- Click viewer to open stream in a new browser tab

## Install

```bash
npm install node-red-dashboard-2-webrtc-viewer