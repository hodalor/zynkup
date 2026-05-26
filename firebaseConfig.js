let firebaseAppModule = null;
let firebaseAuthModule = null;
let expoConstants = null;

try {
  firebaseAppModule = require('@react-native-firebase/app').default;
  firebaseAuthModule = require('@react-native-firebase/auth').default;
  expoConstants = require('expo-constants').default;
} catch {
  firebaseAppModule = null;
  firebaseAuthModule = null;
  expoConstants = null;
}

export const nativeFirebaseReady = Boolean(firebaseAppModule && firebaseAuthModule);
export const firebaseApp = (() => {
  if (!nativeFirebaseReady) {
    return null;
  }

  try {
    return firebaseAppModule.app();
  } catch {
    const extraFirebase = expoConstants?.expoConfig?.extra?.firebase ?? null;
    if (extraFirebase && typeof firebaseAppModule.initializeApp === 'function') {
      try {
        firebaseAppModule.initializeApp(extraFirebase);
        return firebaseAppModule.app();
      } catch {
        return null;
      }
    }
    return null;
  }
})();
export const firebaseAuth = nativeFirebaseReady ? firebaseAuthModule() : null;
export const firebaseConfigReady = Boolean(firebaseApp?.options?.projectId);
