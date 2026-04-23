/**
 * @file analytics-script.js
 * @description XAI (Explainable AI) visualisation engine. Aggregates serverless telemetry 
 * to render real-time multidimensional data via Chart.js.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, getDocs, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const FIREBASE_CONFIG = { 
    apiKey: "AIzaSyAeAKoJdOabY92o-70B7CDSih9oT2fHkGw", 
    authDomain: "pytune-d0d3b.firebaseapp.com", 
    projectId: "pytune-d0d3b", 
    storageBucket: "pytune-d0d3b.firebasestorage.app", 
    messagingSenderId: "4220645617", 
    appId: "1:4220645617:web:cfd28c5776e970c750f950" 
};

const THEME = { primary: '#1DB954', secondary: '#333333', white: '#ffffff', text: '#b3b3b3', fontFamily: 'Montserrat' };
Chart.defaults.color = THEME.text;
Chart.defaults.font.family = THEME.fontFamily;

class AnalyticsDashboard {
    constructor() {
        this.app = initializeApp(FIREBASE_CONFIG);
        this.db = getFirestore(this.app);
        this.auth = getAuth(this.app);
        this.provider = new GoogleAuthProvider();
        
        this.initialise_auth_listener();
    }

    initialise_auth_listener() {
        onAuthStateChanged(this.auth, (user) => {
            const status_text = document.getElementById('auth-status');
            const auth_btn = document.getElementById('auth-action-btn');

            if (user) {
                status_text.innerText = `Hi, ${user.displayName.split(' ')[0]}`;
                auth_btn.innerText = "Logout";
                auth_btn.onclick = async () => {
                    await signOut(this.auth);
                    window.location.reload();
                };
                // Only load database telemetry if successfully authenticated
                this.load_telemetry(user.uid); 
            } else {
                status_text.innerText = "";
                auth_btn.innerText = "Login";
                auth_btn.onclick = async () => {
                    await signInWithPopup(this.auth, this.provider);
                    window.location.reload();
                };
            }
        });
    }

    async load_telemetry(uid) {
        try {
            // Firestore Query: Extracts the last 100 interaction objects for the specific user
            const q = query(collection(this.db, "interactions"), where("uid", "==", uid), orderBy("timestamp", "desc"), limit(100));
            const snapshot = await getDocs(q);
            const raw_data = snapshot.docs.map(doc => doc.data());
            
            if (raw_data.length === 0) return console.warn("No telemetry data found.");
            
            const metrics = this.process_telemetry(raw_data);
            this.render_dashboards(metrics);
        } catch (error) {
            console.error("Failed to load telemetry:", error);
        }
    }

    /**
     * Data Aggregation Layer.
     * Architectural Note: Utilises Array.prototype.reduce() to aggregate vectors, bins, and 
     * conversions in a single pass, resulting in optimal O(N) time complexity.
     */
    process_telemetry(data) {
        const select_events = data.filter(item => item.type === "select");
        const count = select_events.length || 1; 

        const metrics = select_events.reduce((acc, curr) => {
            if (curr.features) {
                acc.vectors.energy += curr.features.energy || 0;
                acc.vectors.tempo += curr.features.tempo || 0;
                acc.vectors.complexity += curr.features.complexity || 0;

                // Statistical binning for complexity histogram
                const comp = curr.features.complexity;
                if (comp < 0.33) acc.bins.Low++;
                else if (comp < 0.66) acc.bins.Med++;
                else acc.bins.High++;
            }
            if (curr.querySource === "Genre") acc.conversions.genre++;
            if (curr.querySource === "Artist") acc.conversions.artist++;

            return acc;
        }, {
            vectors: { energy: 0, tempo: 0, complexity: 0 },
            bins: { Low: 0, Med: 0, High: 0 },
            conversions: { genre: 0, artist: 0 }
        });

        // Calculate arithmetic means for the final radar charts
        return {
            meanVectors: { energy: metrics.vectors.energy / count, tempo: metrics.vectors.tempo / count, complexity: metrics.vectors.complexity / count },
            complexityBins: metrics.bins,
            conversionRates: metrics.conversions
        };
    }

    render_dashboards({ meanVectors, conversionRates, complexityBins }) {
        const seed_data = JSON.parse(localStorage.getItem('pytune_seed'));
        let baseline_vector = [0.5, 0.5, 0.5]; 
        
        // Recalculates the initial seed baseline to visualise the Mean Vector Drift
        if (seed_data) {
            const energy_map = { "Rock": 0.8, "Pop": 0.7, "Hip-Hop": 0.9, "Jazz": 0.4, "Electronic": 0.85 };
            const base_energy = energy_map[seed_data.genre] || 0.5;
            const base_complexity = Math.min((seed_data.trackTimeMillis || 200000) / 300000, 1.0);
            const base_tempo = ((seed_data.trackId || 50) % 100) / 100;
            baseline_vector = [base_energy, base_tempo, base_complexity]; 
        }

        this.render_radar_chart(meanVectors, baseline_vector);
        this.render_query_chart(conversionRates);
        this.render_feature_chart(meanVectors);
        this.render_complexity_chart(complexityBins);
    }

    // --- Chart.js Rendering Modules ---
    
    render_radar_chart({ energy, tempo, complexity }, baseline_vector) {
        const ctx = document.getElementById('radarChart').getContext('2d');
        if (window.radarChartInstance) window.radarChartInstance.destroy();

        window.radarChartInstance = new Chart(ctx, {
            type: 'radar',
            data: {
                labels: ['Energy', 'Tempo', 'Complexity'], 
                datasets: [
                    { label: 'Original Seed', data: baseline_vector, backgroundColor: 'rgba(224, 224, 224, 0.5)', borderColor: THEME.secondary, pointBackgroundColor: THEME.secondary }, 
                    { label: 'Your Mean Drift', data: [energy, tempo, complexity], backgroundColor: 'rgba(29, 185, 84, 0.3)', borderColor: THEME.primary, pointBackgroundColor: THEME.primary }
                ]
            },
            options: { scales: { r: { min: 0, max: 1, angleLines: { color: '#333' }, grid: { color: '#333' } } }, plugins: { legend: { position: 'bottom' } } }
        });
    }

    render_query_chart({ genre, artist }) {
        const ctx = document.getElementById('queryChart').getContext('2d');
        new Chart(ctx, {
            type: 'bar',
            data: { labels: ['Algorithm Query Source'], datasets: [ { label: 'Genre Hybrid Pool', data: [genre], backgroundColor: THEME.primary }, { label: 'Artist Pool', data: [artist], backgroundColor: THEME.white } ] },
            options: { indexAxis: 'y', scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, grid: { display: false } } }, plugins: { legend: { position: 'bottom' } } }
        });
    }

    render_feature_chart({ energy, tempo, complexity }) {
        const ctx = document.getElementById('featureChart').getContext('2d');
        new Chart(ctx, {
            type: 'bar',
            data: { labels: ['Energy', 'Tempo', 'Complexity'], datasets: [{ label: 'Correlation Weight', data: [energy, tempo, complexity], backgroundColor: [THEME.primary, '#444', '#888'], borderRadius: 4 }] },
            options: { scales: { y: { beginAtZero: true, max: 1, grid: { color: '#222' } }, x: { grid: { display: false } } }, plugins: { legend: { display: false } } }
        });
    }

    render_complexity_chart({ Low, Med, High }) {
        const ctx = document.getElementById('complexityChart').getContext('2d');
        new Chart(ctx, {
            type: 'bar',
            data: { labels: ['Low (<2 mins)', 'Medium (~3 mins)', 'High (>4 mins)'], datasets: [{ label: 'Track Frequency', data: [Low, Med, High], backgroundColor: 'rgba(255, 255, 255, 0.8)' }] },
            options: { scales: { y: { beginAtZero: true, grid: { color: '#222' } }, x: { grid: { display: false } } }, plugins: { legend: { display: false } } }
        });
    }
}

const dashboard = new AnalyticsDashboard();