/**
 * @file index-script.js
 * @description Manages application entry and identity provision.
 * Engineered using an Object-Oriented approach to encapsulate authentication state.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// System Configuration
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyAeAKoJdOabY92o-70B7CDSih9oT2fHkGw",
    authDomain: "pytune-d0d3b.firebaseapp.com",
    projectId: "pytune-d0d3b",
    storageBucket: "pytune-d0d3b.firebasestorage.app",
    messagingSenderId: "4220645617",
    appId: "1:4220645617:web:cfd28c5776e970c750f950",
};

class AuthenticationManager {
    constructor() {
        this.app = initializeApp(FIREBASE_CONFIG);
        this.auth = getAuth(this.app);
        this.auth_provider = new GoogleAuthProvider();
        
        // Initialise the event listeners upon instantiation
        this.initialise_observers();
        this.bind_ui_events();
    }

    /**
     * Observer pattern to dynamically synchronise UI with the login state.
     * Prevents the need to manually verify the JSON Web Token on every frame.
     */
    initialise_observers() {
        onAuthStateChanged(this.auth, (user) => {
            const status_text = document.getElementById('auth-status');
            const auth_btn = document.getElementById('auth-action-btn');

            if (user) {
                // UI Formatting: Isolate the first name for a cleaner interface
                status_text.innerText = `Hi, ${user.displayName.split(' ')[0]}`;
                auth_btn.innerText = "Logout";
                
                auth_btn.onclick = async () => {
                    await signOut(this.auth);
                    window.location.reload(); 
                };
            } else {
                status_text.innerText = "";
                auth_btn.innerText = "Login";
                
                auth_btn.onclick = async () => {
                    await signInWithPopup(this.auth, this.auth_provider);
                    window.location.reload();
                };
            }
        });
    }

    bind_ui_events() {
        // Bind the search execution to the UI button
        const search_button = document.getElementById('search-btn');
        if (search_button) {
            search_button.onclick = () => this.start_discovery_process();
        }

        // Allow users to press "Enter" to trigger the search
        const search_input = document.getElementById('user-input');
        if (search_input) {
            search_input.addEventListener('keypress', (event) => {
                if (event.key === 'Enter') this.start_discovery_process();
            });
        }
    }

    /**
     * Fetches the initial seed and delegates state to local memory.
     * Operates asynchronously to prevent main thread blocking during network latency.
     */
    async start_discovery_process() {
        const query_string = document.getElementById('user-input').value;
        if (!query_string) return;

        // Visual feedback for the user while fetching
        const search_button = document.getElementById('search-btn');
        const original_btn_text = search_button.innerText;
        search_button.innerText = "Fetching...";

        try {
            // URL encoding sanitises the input string to prevent REST API failure
            const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query_string)}&entity=song&limit=1`);
            const data = await response.json();
            
            if (!data.results || !data.results.length) {
                search_button.innerText = original_btn_text;
                return alert("Song not found. Please try another track.");
            }
            
            const seed = data.results[0];
            
            // Cache Invalidation: Clear residual session data to ensure accurate Vector Drift calculations
            localStorage.removeItem('pytune_session_active');
            
            // Serialise the seed object to bypass database persistence (Data Minimisation)
            localStorage.setItem('pytune_seed', JSON.stringify({
                trackName: seed.trackName,
                artistName: seed.artistName,
                genre: seed.primaryGenreName,
                previewUrl: seed.previewUrl,
                artwork: seed.artworkUrl100
            }));
            
            // Transition state to the discovery engine
            window.location.href = "discover.html";
            
        } catch (error) { 
            console.error("Failed to initialise discovery:", error);
            search_button.innerText = "Error - Try Again";
        }
    }
}

// Instantiate the manager (Mimics a Game Engine Boot Sequence)
const auth_manager = new AuthenticationManager();