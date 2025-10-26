
import { initializeApp } from "firebase/app";
import { getAuth, signOut, connectAuthEmulator, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, connectFirestoreEmulator } from "firebase/firestore";

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {

  apiKey: "AIzaSyD5dVFY4bCtPlaNAw9u74MOl_vppWxW0L0",
  authDomain: "egokai-tcg.firebaseapp.com",
  projectId: "egokai-tcg",
  storageBucket: "egokai-tcg.firebasestorage.app",
  messagingSenderId: "580077490718",
  appId: "1:580077490718:web:be5c4c3b47167ac1aed40f",
  measurementId: "G-BXHBYEB0DY"

};


// Initialize Firebase

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);


const provider = new GoogleAuthProvider();

export { db, auth }

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then(reg => console.log('Service Worker registered'))
      .catch(err => console.log('Service Worker registration failed:', err));
  });
}