<template>
  <div class="ui-webrtc-viewer-wrapper" @click="openInNewTab">
    <video ref="video" autoplay muted playsinline></video>

    <div v-if="streamName" class="stream-name">
      {{ streamName }}
    </div>
    <div v-if="connectionState !== 'Connected'" class="connection-state">
      {{ connectionState }}
    </div>
  </div>
</template>

<script>
import { mapState } from "vuex";

export default {
  name: "UIWebRTCViewer",

  props: {
    /* Dashboard Layout Manager에서 전달 */
    id: {
      type: String,
      required: true,
    },

    /* Node-RED 노드 설정값 */
    props: {
      type: Object,
      default: () => ({}),
    },

    /* Dashboard 상태 */
    state: {
      type: Object,
      default: () => ({
        enabled: false,
        visible: false,
      }),
    },
  },

  inject: ["$dataTracker"],

  data() {
    return {
      pc: null,
      // 실제 현재 연결에 사용하는 URL
      currentUrl: "",
      // msg.topic
      streamName: "",
      connectionState: "Waiting...",
      reconnectTimer: null,
    };
  },

  computed: {
    ...mapState("data", ["messages"]),

    reconnectInterval() {
      const value = Number(this.props.reconnectInterval);

      return Number.isFinite(value) && value >= 0 ? value : 3000;
    },
  },

  created() {
    /*
     * Node-RED에서 전달되는 msg를 받는다.
     */
    this.$dataTracker(
      this.id,
      this.onInput,
      this.onLoad,
      this.onDynamicProperties,
    );
  },

  beforeUnmount() {
    this.stop();
  },

  methods: {
    /*
     * Node-RED에서 새로운 msg가 들어올 때 호출
     */
    onInput(msg) {
      // Dashboard VueX에 최신 msg 저장
      this.$store.commit("data/bind", {
        widgetId: this.id,
        msg,
      });

      this.handleMessage(msg);
    },

    /*
     * Dashboard가 처음 로드될 때
     * Node-RED datastore에 저장되어 있던 마지막 msg
     */
    onLoad(msg, state) {
      if (msg) {
        this.handleMessage(msg);
      }

      /*
       * 마지막 msg가 없더라도
       * 노드 설정의 URL은 기본 URL로 사용한다.
       */
      if (!this.currentUrl) {
        this.setInitialUrl();
      }

      if (!this.streamName) {
        this.setInitialStreamName();
      }
    },

    /*
     * 현재 메시지를 처리
     */
    handleMessage(msg) {
      if (!msg) {
        return;
      }

      /*
       * topic은 스트림 이름으로 사용
       */
      if (typeof msg.topic === "string" && msg.topic.trim() !== "") {
        this.streamName = msg.topic.trim();
      }

      /*
       * payload가 문자열이고 비어 있지 않으면
       * WebRTC URL을 변경한다.
       */
      if (typeof msg.payload === "string" && msg.payload.trim() !== "") {
        const newUrl = msg.payload.trim();

        if (newUrl !== this.currentUrl) {
          this.currentUrl = newUrl;

          this.connect();
        }
      }
    },

    /*
     * Node 설정에 저장된 URL을 초기 URL로 사용
     */
    setInitialUrl() {
      const url = this.props.url;

      if (typeof url !== "string" || url.trim() === "") {
        return;
      }

      this.currentUrl = url.trim();

      this.connect();
    },

    setInitialStreamName() {
      const streamName = this.props.streamName;
      if (typeof streamName === "string" && streamName.trim() !== "") {
        this.streamName = streamName.trim();
      }
    },

    /*
     * WebRTC 연결
     */
    async connect() {
      if (!this.currentUrl) {
        return;
      }

      this.clearReconnectTimer();

      /*
       * 기존 연결 종료
       */
      this.stopPeerConnection();

      this.connectionState = "Connecting";

      const pc = new RTCPeerConnection();

      /*
       * 현재 연결인지 확인하기 위해
       * this.pc에 저장
       */
      this.pc = pc;

      /*
       * Video만 수신
       */
      pc.addTransceiver("video", {
        direction: "recvonly",
      });

      /*
       * MediaStream 수신
       */
      pc.ontrack = (event) => {
        /*
         * 이미 다른 PeerConnection으로
         * 변경되었다면 무시
         */
        if (this.pc !== pc) {
          return;
        }

        if (event.streams && event.streams[0]) {
          this.$refs.video.srcObject = event.streams[0];
        }
      };

      /*
       * WebRTC 연결 상태 감시
       */
      pc.onconnectionstatechange = () => {
        if (this.pc !== pc) {
          return;
        }

        const state = pc.connectionState;

        console.log("WebRTC connection state:", state);

        switch (state) {
          case "new":
            this.connectionState = "Connecting";
            break;

          case "connecting":
            this.connectionState = "Connecting";
            break;

          case "connected":
            this.connectionState = "Connected";
            this.clearReconnectTimer();
            break;

          case "disconnected":
            this.connectionState = "Disconnected";
            this.scheduleReconnect();
            break;

          case "failed":
            this.connectionState = "Failed";
            this.scheduleReconnect();
            break;

          case "closed":
            this.connectionState = "Closed";
            this.scheduleReconnect();
            break;
        }
      };

      try {
        /*
         * SDP Offer 생성
         */
        const offer = await pc.createOffer();

        if (this.pc !== pc) {
          return;
        }

        await pc.setLocalDescription(offer);

        if (this.pc !== pc) {
          return;
        }

        /*
         * ICE gathering 완료 대기
         */
        await this.waitForIceGatheringComplete(pc);

        if (this.pc !== pc) {
          return;
        }

        /*
         * MediaMTX WHEP endpoint
         */
        const whepUrl = this.currentUrl.replace(/\/$/, "") + "/whep";

        const response = await fetch(whepUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/sdp",
          },
          body: pc.localDescription.sdp,
        });

        if (!response.ok) {
          throw new Error(`WHEP request failed: ${response.status}`);
        }

        const answer = await response.text();

        if (this.pc !== pc) {
          return;
        }

        await pc.setRemoteDescription({
          type: "answer",
          sdp: answer,
        });
      } catch (error) {
        console.error("WebRTC connection error:", error);

        /*
         * 현재 연결에서 발생한 오류만 처리
         */
        if (this.pc === pc) {
          this.connectionState = 'Failed'
          this.stopPeerConnection();
          this.scheduleReconnect();
        }
      }
    },

    /*
     * ICE gathering 완료 대기
     */
    waitForIceGatheringComplete(pc) {
      return new Promise((resolve) => {
        if (pc.iceGatheringState === "complete") {
          resolve();
          return;
        }

        const checkState = () => {
          if (pc.iceGatheringState === "complete") {
            pc.removeEventListener("icegatheringstatechange", checkState);

            resolve();
          }
        };

        pc.addEventListener("icegatheringstatechange", checkState);
      });
    },

    /*
     * 재연결 예약
     */
    scheduleReconnect() {
      if (!this.currentUrl) {
        return;
      }

      /*
       * 이미 재연결 예약이 있으면
       * 중복으로 만들지 않는다.
       */
      if (this.reconnectTimer) {
        return;
      }

      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;

        this.connect();
      }, this.reconnectInterval);
    },

    /*
     * 재연결 타이머 제거
     */
    clearReconnectTimer() {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);

        this.reconnectTimer = null;
      }
    },

    /*
     * PeerConnection만 종료
     */
    stopPeerConnection() {
      if (this.pc) {
        this.pc.ontrack = null;
        this.pc.onconnectionstatechange = null;

        this.pc.close();
        this.pc = null;
      }

      if (this.$refs.video) {
        this.$refs.video.srcObject = null;
      }
    },

    /*
     * 전체 정리
     */
    stop() {
      this.clearReconnectTimer();
      this.stopPeerConnection();
    },

    /*
     * Dynamic properties
     *
     * 현재는 사용하지 않음.
     */
    onDynamicProperties(msg) {
      // 향후 msg.ui_update가 필요하면 여기에서 처리
    },

    openInNewTab() {
      if (this.currentUrl) {
        window.open(this.currentUrl, "_blank");
      }
    },
  },
};
</script>

<style scoped>
.ui-webrtc-viewer-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
  cursor: pointer;
}

video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.stream-name {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 12px;
  border-radius: 3px;
}

.connection-state {
    position: absolute;
    left: 8px;
    bottom: 8px;
    padding: 4px 8px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font-size: 12px;
    border-radius: 3px;
}
</style>
