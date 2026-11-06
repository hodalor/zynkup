import { AppRegistry } from 'react-native';
import App from './App';

try {
  const messaging = require('@react-native-firebase/messaging').default;
  messaging().setBackgroundMessageHandler(async () => {
    // Android draws the alert from the push payload, using the ZynkUp sound.
  });
} catch {
  // The native messaging module is absent until the next install.
}

AppRegistry.registerComponent('main', () => App);
