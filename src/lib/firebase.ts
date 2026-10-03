import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';

export const firebaseConfig = {
  apiKey: 'AIzaSyAZEnJOLnAp6SrLI5LEXGQKSeQ4Utp6NKM',
  authDomain: 'gen-lang-client-0105737183.firebaseapp.com',
  projectId: 'gen-lang-client-0105737183',
  storageBucket: 'gen-lang-client-0105737183.firebasestorage.app',
  messagingSenderId: '100892974326',
  appId: '1:100892974326:web:da7a01b142ccceb19060d7',
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const token = await result.user.getIdToken();
    return { user: result.user, token, error: null };
  } catch (error: any) {
    console.warn('Firebase popup sign-in encountered an issue or was blocked:', error);
    return { user: null, token: null, error };
  }
}

export async function signOutFirebase() {
  await firebaseSignOut(auth);
}
