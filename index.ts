import { AppRegistry, NativeModules } from 'react-native';
import App from './App';

const API_BASE_URL = 'https://zynkup-api-597625475865.europe-west9.run.app';

try {
  const messaging = require('@react-native-firebase/messaging').default;
  messaging().setBackgroundMessageHandler(async (remoteMessage: { data?: Record<string, string> }) => {
    const data = remoteMessage?.data ?? {};
    const cue = NativeModules.CueSound;
    if (data.type === 'call') {
      cue?.showIncomingCall?.(data.title || 'ZynkUp', data.body || 'Incoming call');
      if (data.callId) {
        await fetch(`${API_BASE_URL}/api/calls/${data.callId}/reached`, { method: 'POST' }).catch(() => undefined);
      }
      return;
    }
    if (data.type === 'message') {
      cue?.showMessageNotification?.(data.title || 'ZynkUp', data.body || 'New message');
      if (data.messageId) {
        await fetch(`${API_BASE_URL}/api/messages/${data.messageId}/receipt`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: 'delivered' }),
        }).catch(() => undefined);
      }
    }
  });
} catch {
  // The native messaging module is absent until the next install.
}

AppRegistry.registerComponent('main', () => App);
