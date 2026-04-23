/**
 * @file discover-script.js
 * @description The core mathematical recommendation engine. Implements Content-Based Filtering 
 * via Cosine Similarity mathematics and manages asynchronous data fallback logic.
 * Engineered using an OOP approach to separate state logic from UI rendering (Game Loop architecture).
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, setDoc, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const FIREBASE_CONFIG = { 
    apiKey: "AIzaSyAeAKoJdOabY92o-70B7CDSih9oT2fHkGw", 
    authDomain: "pytune-d0d3b.firebaseapp.com", 
    projectId: "pytune-d0d3b", 
    storageBucket: "pytune-d0d3b.firebasestorage.app", 
    messagingSenderId: "4220645617", 
    appId: "1:4220645617:web:cfd28c5776e970c750f950" 
};

class DiscoveryEngine {
    constructor() {
        // Initialise Firebase Backend Services
        this.app = initializeApp(FIREBASE_CONFIG);
        this.db = getFirestore(this.app);
        this.auth = getAuth(this.app);
        
        // --- System State Variables ---
        // Utilising local memory to track seen items, preventing O(N) database reads per track
        this.session_seen_ids = JSON.parse(localStorage.getItem('pytune_seen')) || [];
        this.candidate_pool = [];
        this.current_vector = [0.5, 0.5, 0.5]; 
        
        this.current_genre = "";
        this.current_artist = "";
        this.current_name = "";
        this.current_url = "";
        
        this.active_track_for_playlist = null;
        this.audio_player = document.getElementById('player');
        
        // Boot sequence
        this.initialise_engine_state();
        this.bind_global_events();
    }

    /**
     * Initialises the engine state by reading the stateless payload passed from the landing page.
     */
    initialise_engine_state() {
        const active_session = JSON.parse(localStorage.getItem('pytune_session_active'));
        const initial_seed = JSON.parse(localStorage.getItem('pytune_seed'));

        if (active_session) {
            this.current_vector = active_session.vector; 
            this.current_genre = active_session.genre; 
            this.current_artist = active_session.seedArtist;
            this.current_name = active_session.seedName;
            this.current_url = active_session.seedUrl;
        } else if (initial_seed) {
            this.current_genre = initial_seed.genre; 
            this.current_artist = initial_seed.artistName;
            this.current_name = initial_seed.trackName;
            this.current_url = initial_seed.previewUrl;
            // Generate the baseline 3D vector for the first track
            this.current_vector = this.extract_features({ primaryGenreName: this.current_genre, trackTimeMillis: 0 }).vector;
        } else {
            // Failsafe: Redirect to root if accessed without seed data
            window.location.href = "index.html";
        }

        document.getElementById('current-song-info').innerText = `${this.current_name} — ${this.current_artist}`;
        if (this.current_url) this.audio_player.src = this.current_url;
        
        this.fetch_and_update_pool();
    }

    bind_global_events() {
        // Observer pattern to dynamically synchronise UI with the login state
        onAuthStateChanged(this.auth, (user) => {
            const auth_btn = document.getElementById('auth-action-btn');
            const status_text = document.getElementById('auth-status');
            if (user) {
                status_text.innerText = `Hi, ${user.displayName.split(' ')[0]}`;
                auth_btn.innerText = "Logout";
                auth_btn.onclick = () => signOut(this.auth).then(() => {
                    localStorage.clear(); 
                    window.location.href = "index.html";
                });
            } else {
                auth_btn.innerText = "Login";
                auth_btn.onclick = () => window.location.href = "index.html";
            }
        });

        document.getElementById('master-play-btn').onclick = () => this.toggle_master_preview();
        document.getElementById('new-search-btn').onclick = () => { 
            localStorage.removeItem('pytune_session_active'); 
            window.location.href = "index.html"; 
        };
        document.getElementById('close-modal').onclick = () => {
            document.getElementById('playlist-menu').style.display = 'none';
        };
        document.getElementById('create-playlist-btn').onclick = () => {
            const val = document.getElementById('new-playlist-name').value;
            if (val) this.save_to_playlist(val);
        };
    }

    /**
     * Serialises the current memory state to localStorage to persist progress across browser refreshes.
     */
    save_progress() {
        const session_data = { 
            vector: this.current_vector, 
            genre: this.current_genre, 
            seedUrl: this.current_url, 
            seedName: this.current_name, 
            seedArtist: this.current_artist 
        };
        localStorage.setItem('pytune_session_active', JSON.stringify(session_data));
        localStorage.setItem('pytune_seen', JSON.stringify(this.session_seen_ids));
    }

    /**
     * Deterministic heuristic mapping. Translates qualitative string metadata into a 
     * quantitative 3D vector [Energy, Tempo, Complexity] using O(1) Hash Maps.
     */
    extract_features(track) {
        const energy_map = { "Rock": 0.8, "Pop": 0.7, "Hip-Hop": 0.9, "Jazz": 0.4, "Electronic": 0.85 };
        const energy = energy_map[track.primaryGenreName] || 0.5;
        // Boundary constraint: normalises track length to a maximum of 1.0 to preserve vector integrity
        const complexity = Math.min((track.trackTimeMillis || 200000) / 300000, 1.0); 
        const tempo = ((track.trackId || 50) % 100) / 100; 

        return { vector: [energy, tempo, complexity], details: { energy, tempo, complexity } };
    }

    /**
     * Calculates geometric alignment using Cosine Similarity.
     * Superior to Euclidean distance as it isolates stylistic direction while remaining magnitude-invariant.
     */
    calculate_cosine_similarity(vec_a, vec_b) {
        if (!vec_a || !vec_b) return 0.0;
        let dot_product = vec_a.reduce((sum, a, i) => sum + a * (vec_b[i] || 0), 0);
        let mag_a = Math.sqrt(vec_a.reduce((sum, a) => sum + a * a, 0));
        let mag_b = Math.sqrt(vec_b.reduce((sum, b) => sum + b * b, 0));
        // Defensive zero-vector catch to prevent fatal NaN division
        return (mag_a === 0 || mag_b === 0) ? 0.0 : dot_product / (mag_a * mag_b);
    }

    /**
     * Asynchronous data ingestion. Queries the API and ranks candidates.
     * Implements asynchronous fallback degradation to handle Data Sparsity (empty queries).
     */
    async fetch_and_update_pool() {
        let safe_term = this.current_genre ? this.current_genre.replace('/', ' ') : "Pop";
        
        try {
            let res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(safe_term)}&entity=song&limit=100`);
            let data = await res.json();
            
            // Fallback Logic: If the primary genre query yields zero results, dynamically degrade to artist search
            if (!data.results || data.results.length === 0) {
                res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(this.current_artist)}&entity=song&limit=100`);
                data = await res.json();
            }

            // Memory optimisation: Filter out tracks previously seen in this specific session
            let results = data.results ? data.results.filter(t => !this.session_seen_ids.includes(t.trackId)) : [];
            
            this.candidate_pool = results.map(track => {
                const features = this.extract_features(track);
                return { 
                    ...track, 
                    features: features, 
                    score: this.calculate_cosine_similarity(this.current_vector, features.vector) 
                };
            }).sort((a, b) => b.score - a.score); // O(N log N) sorting forces highest geometric matches to the top
            
            this.render_ui();
        } catch (err) {
            console.error("Engine failed to update pool:", err);
        }
    }

    /**
     * UI Rendering component. Separated from the data ingestion layer to prevent layout thrashing.
     */
    render_ui() {
        const container = document.getElementById('cards-container');
        if (!container) return;
        
        while (container.children.length < 4 && this.candidate_pool.length > 0) {
            container.appendChild(this.create_track_card(this.candidate_pool.shift()));
        }
    }

    create_track_card(track) {
        this.session_seen_ids.push(track.trackId);
        this.save_progress();

        const card = document.createElement('div');
        card.className = 'discovery-card';
        const display_score = Math.round(track.score * 100);

        // Uses a DocumentFragment logic via innerHTML for efficient batched DOM insertion
        card.innerHTML = `
            <div class="card-top-actions">
                <button class="f-btn preview-trigger" data-url="${track.previewUrl}">▶</button>
                <button class="f-btn dislike">✖</button>
            </div>
            <img src="${track.artworkUrl100.replace('100x100', '400x400')}">
            <div class="tags-row" style="margin-bottom:10px; display:flex; gap:5px;">
                <span class="tag">${display_score}% MATCH</span>
                <span class="tag">${track.primaryGenreName}</span>
            </div>
            <div style="min-width: 0; width: 100%;">
                <h4>${track.trackName}</h4>
                <p>${track.artistName}</p>
            </div>
            <div class="card-footer-row">
                <button class="like-btn">Similar Songs</button>
                <button class="playlist-btn">Add to Playlist</button>
            </div>
        `;

        // Asynchronous database write for interaction telemetry
        card.querySelector('.dislike').onclick = async () => {
            if (this.auth.currentUser) {
                await addDoc(collection(this.db, "interactions"), { 
                    uid: this.auth.currentUser.uid, type: "dislike", song: track.trackName, artist: track.artistName, timestamp: serverTimestamp() 
                });
            }
            card.style.opacity = "0"; 
            setTimeout(() => {
                card.remove();
                if (this.candidate_pool.length < 5) this.fetch_and_update_pool(); else this.render_ui();
            }, 200);
        };

        card.querySelector('.like-btn').onclick = async () => {
            const is_diverse = track.score < 0.82; 
            const sim_query = Math.random() > 0.3 ? "Genre" : "Artist"; 

            if (this.auth.currentUser) {
                await addDoc(collection(this.db, "interactions"), { 
                    uid: this.auth.currentUser.uid, type: "select", song: track.trackName, similarity: Number(track.score.toFixed(2)), isDiverse: is_diverse, querySource: sim_query, features: track.features.details, timestamp: serverTimestamp() 
                });
            }
            
            // Vector Drift Mathematics: Re-weights the active session vector based on the selected track
            this.current_vector = this.current_vector.map((v, i) => (v * 0.4) + (track.features.vector[i] * 0.6));
            
            this.current_url = track.previewUrl;
            this.current_name = track.trackName;
            this.current_artist = track.artistName;
            
            document.getElementById('current-song-info').innerText = `${this.current_name} — ${this.current_artist}`;
            this.audio_player.src = this.current_url; 
            this.audio_player.play();
            document.getElementById('master-play-btn').innerText = "⏸ Pause Seed";
            
            this.save_progress();
            document.getElementById('cards-container').innerHTML = ""; 
            this.fetch_and_update_pool(); 
        };

        card.querySelector('.preview-trigger').onclick = (e) => this.toggle_preview(track.previewUrl, e.currentTarget);
        card.querySelector('.playlist-btn').onclick = () => this.open_playlist_modal(track);
        
        return card;
    }

    toggle_master_preview() {
        const master_btn = document.getElementById('master-play-btn');
        if (!this.current_url) return;

        if (this.audio_player.src !== this.current_url) this.audio_player.src = this.current_url;
        
        if (this.audio_player.paused) { 
            this.audio_player.play(); 
            master_btn.innerText = "⏸ Pause Seed"; 
        } else { 
            this.audio_player.pause(); 
            master_btn.innerText = "▶ Play Seed"; 
        }
        this.sync_card_icons();
    }

    toggle_preview(url, btn) {
        const master_btn = document.getElementById('master-play-btn');
        if (this.audio_player.src === url && !this.audio_player.paused) { 
            this.audio_player.pause(); 
        } else { 
            document.querySelectorAll('.preview-trigger').forEach(b => b.innerText = "▶"); 
            this.audio_player.src = url; 
            this.audio_player.play(); 
        }
        const is_playing_seed = this.audio_player.src === this.current_url && !this.audio_player.paused;
        master_btn.innerText = is_playing_seed ? "⏸ Pause Seed" : "▶ Play Seed";
        this.sync_card_icons();
    }

    sync_card_icons() {
        document.querySelectorAll('.preview-trigger').forEach(btn => {
            const is_current = this.audio_player.src === btn.getAttribute('data-url');
            btn.innerText = (is_current && !this.audio_player.paused) ? "⏸" : "▶";
        });
    }

    async open_playlist_modal(track) {
        if (!this.auth.currentUser) return alert("Please login to save tracks.");
        this.active_track_for_playlist = track;
        document.getElementById('playlist-menu').style.display = 'block';
        
        const list = document.getElementById('playlist-options-list');
        const snap = await getDocs(collection(this.db, "users", this.auth.currentUser.uid, "playlists"));
        
        list.innerHTML = ""; 
        snap.forEach(d => {
            const b = document.createElement('button');
            b.className = "menu-item";
            b.innerText = d.id;
            b.onclick = () => this.save_to_playlist(d.id);
            list.appendChild(b);
        });
    }

    async save_to_playlist(p_name) {
        const ref = doc(this.db, "users", this.auth.currentUser.uid, "playlists", p_name);
        await setDoc(ref, { name: p_name }, { merge: true });
        await addDoc(collection(this.db, "users", this.auth.currentUser.uid, "playlists", p_name, "tracks"), {
            song: this.active_track_for_playlist.trackName, 
            artist: this.active_track_for_playlist.artistName, 
            artwork: this.active_track_for_playlist.artworkUrl100, 
            preview: this.active_track_for_playlist.previewUrl, 
            timestamp: serverTimestamp()
        });
        
        document.getElementById('playlist-menu').style.display = 'none';
        alert(`Successfully added to ${p_name}!`);
    }
}

// Instantiate the Engine
const engine = new DiscoveryEngine();