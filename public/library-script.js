/**
 * @file library-script.js
 * @description Manages persistent state and database CRUD operations. 
 * Utilises a hierarchical NoSQL schema for highly efficient read operations.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, getDocs, deleteDoc, doc, setDoc, query, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut, signInWithPopup, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const FIREBASE_CONFIG = { 
    apiKey: "AIzaSyAeAKoJdOabY92o-70B7CDSih9oT2fHkGw", 
    authDomain: "pytune-d0d3b.firebaseapp.com", 
    projectId: "pytune-d0d3b", 
    storageBucket: "pytune-d0d3b.firebasestorage.app", 
    messagingSenderId: "4220645617", 
    appId: "1:4220645617:web:cfd28c5776e970c750f950" 
};

class LibraryManager {
    constructor() {
        this.app = initializeApp(FIREBASE_CONFIG);
        this.db = getFirestore(this.app);
        this.auth = getAuth(this.app);
        this.provider = new GoogleAuthProvider();
        
        this.bind_modal_events();
        this.initialise();
    }

    initialise() {
        onAuthStateChanged(this.auth, (user) => {
            const status_text = document.getElementById('auth-status'); 
            const auth_btn = document.getElementById('auth-action-btn');

            if (user) {
                status_text.innerText = `Hi, ${user.displayName.split(' ')[0]}`; 
                auth_btn.innerText = "Logout";
                auth_btn.onclick = () => signOut(this.auth).then(() => window.location.reload());
                this.render_playlist_grid(user.uid); 
            } else {
                auth_btn.innerText = "Login";
                auth_btn.onclick = () => signInWithPopup(this.auth, this.provider);
            }
        });
    }

    bind_modal_events() {
        // Modal UI display toggles
        document.getElementById('close-library-modal').onclick = () => {
            document.getElementById('custom-playlist-modal').style.display = 'none';
        };

        // CREATE Operation: Database Write
        document.getElementById('submit-new-playlist').onclick = async () => {
            const name = document.getElementById('library-playlist-input').value;
            if (name && this.auth.currentUser) {
                await setDoc(doc(this.db, "users", this.auth.currentUser.uid, "playlists", name), { name: name, created: serverTimestamp() });
                
                document.getElementById('custom-playlist-modal').style.display = 'none';
                document.getElementById('library-playlist-input').value = ""; 
                // Refresh local DOM state
                this.render_playlist_grid(this.auth.currentUser.uid); 
            }
        };
    }

    /**
     * READ Operation: Fetches and displays root playlists.
     */
    async render_playlist_grid(uid) {
        const root = document.getElementById('playlists-root'); 
        const back_btn = document.getElementById('back-to-lib'); 
        const header = document.getElementById('library-header');

        header.style.display = "block"; 
        back_btn.style.display = "none"; 
        root.innerHTML = `<div class="grid-layout" id="lib-grid"></div>`;
        const grid = document.getElementById('lib-grid');

        const add_card = document.createElement('div'); 
        add_card.className = "discovery-card add-playlist-card"; 
        add_card.innerHTML = `<div style="font-size:3rem; color:#1DB954; text-align:center;">+</div><h3 style="text-align:center;">New Playlist</h3>`;

        add_card.onclick = () => {
            document.getElementById('custom-playlist-modal').style.display = 'block';
        };
        grid.appendChild(add_card);

        const playlist_snap = await getDocs(collection(this.db, "users", uid, "playlists"));
        
        playlist_snap.forEach(async (p_doc) => {
            // Efficiency trick: Limits query to O(1) just to fetch the album artwork cover for the playlist
            const track_query = query(collection(this.db, "users", uid, "playlists", p_doc.id, "tracks"), limit(1));
            const track_snap = await getDocs(track_query);
            
            const card = document.createElement('div'); 
            card.className = "discovery-card";
            const artwork_url = track_snap.empty ? "https://via.placeholder.com/400?text=Empty" : track_snap.docs[0].data().artwork.replace('100x100', '400x400');
            
            card.innerHTML = `<img src="${artwork_url}"><h3>${p_doc.id}</h3><p>Playlist</p>`;
            card.onclick = () => this.render_track_list(uid, p_doc.id); 
            grid.appendChild(card);
        });
    }

    /**
     * READ & DELETE Operations: Fetches tracks within a specific sub-collection.
     */
    async render_track_list(uid, playlist_name) {
        const root = document.getElementById('playlists-root'); 
        const back_btn = document.getElementById('back-to-lib');
        
        document.getElementById('library-header').style.display = "none"; 
        back_btn.style.display = "block"; 
        back_btn.onclick = () => this.render_playlist_grid(uid);

        root.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:30px;">
                <h1 class="hero-title">${playlist_name}</h1>
                <button id="del-p" class="del-playlist-btn">Delete Playlist</button>
            </div>
            <table class="track-list"><tbody id="rows"></tbody></table>
        `;

        document.getElementById('del-p').onclick = async () => {
            if (confirm(`Are you sure you want to delete "${playlist_name}"?`)) {
                await deleteDoc(doc(this.db, "users", uid, "playlists", playlist_name));
                this.render_playlist_grid(uid);
            }
        };

        const track_snap = await getDocs(collection(this.db, "users", uid, "playlists", playlist_name, "tracks"));
        
        track_snap.forEach(t_doc => {
            const data = t_doc.data(); 
            const row = document.createElement('tr');

            row.innerHTML = `
                <td><img src="${data.artwork}" class="track-artwork-sm"></td>
                <td><b>${data.song}</b><br><small>${data.artist}</small></td>
                <td style="text-align:right;"><button class="track-del-btn">Remove</button></td>
            `;

            // Garbage Collection: Removes the element from the DOM immediately prior to database 
            // deletion to ensure zero-latency UI responsiveness (Optimistic UI updating).
            row.querySelector('.track-del-btn').onclick = async () => {
                await deleteDoc(doc(this.db, "users", uid, "playlists", playlist_name, "tracks", t_doc.id));
                row.remove(); 
            };
            document.getElementById('rows').appendChild(row);
        });
    }
}

const library = new LibraryManager();