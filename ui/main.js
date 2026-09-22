/**
 * Used only for development (via `npm run dev`).
 *
 * This file is useful for testing your component in isolation from Node-RED.
 */
import { createApp } from 'vue'

import UIWebRTCViewer from './components/UIWebRTCViewer.vue'

createApp(UIWebRTCViewer).mount('#app')
