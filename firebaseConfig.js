let firebaseAppModule = null;
let firebaseAuthModule = null;

try {
  firebaseAppModule = require('@react-native-firebase/app').default;
  firebaseAuthModule = require('@react-native-firebase/auth').default;
} catch {
  firebaseAppModule = null;
  firebaseAuthModule = null;
}

export const nativeFirebaseReady = Boolean(firebaseAppModule && firebaseAuthModule);
export const firebaseApp = (() => {
  if (!nativeFirebaseReady) {
    return null;
  }

  try {
    return firebaseAppModule.app();
  } catch {
    return null;
  }
})();
export const firebaseAuth = nativeFirebaseReady ? firebaseAuthModule() : null;
export const firebaseConfigReady = Boolean(firebaseApp?.options?.projectId);
