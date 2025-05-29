# strava-webgl-viz
Visualization that shows all your Strava activity with the same starting point.

Okay, this is a significant upgrade involving a backend for Strava authentication, API interaction, and a shift to WebGL for rendering. This will be a multi-file project.

**This guide will be quite long and detailed. I'll break it down into manageable steps.**

**Core Concepts:**

1.  **Strava API & OAuth 2.0:** To get user data, your app needs to authenticate with Strava using OAuth 2.0. This requires a backend component to securely handle your Strava API Client Secret.
2.  **Backend (Node.js & Express):** We'll create a simple Node.js server with Express.js to:
    *   Serve the frontend HTML/CSS/JS.
    *   Handle the Strava OAuth callback.
    *   Exchange the authorization code for an access token.
    *   Proxy API requests to Strava (optional, but good for hiding tokens and managing rate limits).
3.  **Frontend (HTML, CSS, JavaScript):**
    *   Initiate the OAuth flow.
    *   Fetch activity data from our backend (which then calls Strava).
    *   Process this data (decode polylines, translate to origin).
    *   Render using WebGL. We'll use a library like **`regl`** to simplify WebGL. Raw WebGL is very verbose.
4.  **WebGL Rendering (`regl`):**
    *   **Shaders:** Small programs running on the GPU (Vertex Shader for positions, Fragment Shader for colors).
    *   **Buffers:** Memory on the GPU to store vertex data (positions, colors, etc.).
    *   **Draw Calls:** Commands to tell the GPU to render.
    *   **Line Thickness in WebGL:** `gl.LINES` primitive typically has a fixed width or very limited `gl.lineWidth()` range. True variable thickness requires rendering lines as "quads" (two triangles per segment), which adds complexity. We'll start with color indicating overlap and potentially use `gl.lineWidth` with its limitations or discuss the quad approach.

**Project Structure (in VS Code):**

```
strava-webgl-viz/
├── public/                     # Frontend files
│   ├── index.html
│   ├── style.css
│   ├── app.js                  # Main frontend JavaScript
│   └── lib/                    # Third-party libraries (like regl)
├── server.js                   # Node.js backend
├── package.json                # Node.js project file
└── .env                        # For storing Strava credentials (DO NOT COMMIT)
```

---

**Step-by-Step Implementation Guide:**

**Step 0: Prerequisites**

1.  **Node.js and npm:** Install from [https://nodejs.org/](https://nodejs.org/)
2.  **VS Code:** Your chosen editor.
3.  **Strava API Application:**
    *   Go to [https://www.strava.com/settings/api](https://www.strava.com/settings/api)
    *   Create a new application.
    *   **Application Name:** e.g., "My Origin Visualizer"
    *   **Website:** e.g., `http://localhost:3000`
    *   **Authorization Callback Domain:** `localhost`
    *   Note down your **Client ID** and **Client Secret**. **Keep the Client Secret confidential!**

---

**Step 1: Backend Setup (Node.js/Express)**

1.  **Create Project Folder:**
    ```bash
    mkdir strava-webgl-viz
    cd strava-webgl-viz
    ```

2.  **Initialize Node.js Project:**
    ```bash
    npm init -y
    ```

3.  **Install Dependencies:**
    ```bash
    npm install express axios dotenv body-parser express-session
    # express: web framework
    # axios: for making HTTP requests to Strava API
    # dotenv: to load environment variables from .env file
    # body-parser: to parse request bodies (though Express has its own now)
    # express-session: to manage user sessions for storing access tokens
    ```

4.  **Create `.env` file (in the root `strava-webgl-viz/` folder):**
    ```
    STRAVA_CLIENT_ID=YOUR_CLIENT_ID
    STRAVA_CLIENT_SECRET=YOUR_CLIENT_SECRET
    STRAVA_REDIRECT_URI=http://localhost:3000/strava/callback
    SESSION_SECRET=a_very_strong_random_secret_string_for_sessions
    PORT=3000
    ```
    *   Replace `YOUR_CLIENT_ID` and `YOUR_CLIENT_SECRET` with your actual credentials.
    *   Make sure `STRAVA_REDIRECT_URI` matches what you'll use in Strava settings and your code.

5.  **Create `server.js`:**

    ```javascript
    // server.js
    require('dotenv').config();
    const express = require('express');
    const axios = require('axios');
    const path = require('path');
    const session = require('express-session');

    const app = express();
    const port = process.env.PORT || 3000;

    // Strava Credentials from .env
    const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
    const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
    const STRAVA_REDIRECT_URI = process.env.STRAVA_REDIRECT_URI;

    // Middleware
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from public/

    app.use(session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: true,
        cookie: { secure: false } // Set to true if using HTTPS
    }));

    // --- Strava OAuth Routes ---
    app.get('/strava/authorize', (req, res) => {
        const authUrl = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${STRAVA_REDIRECT_URI}&approval_prompt=auto&scope=read,activity:read_all`;
        res.redirect(authUrl);
    });

    app.get('/strava/callback', async (req, res) => {
        const code = req.query.code;
        if (!code) {
            return res.status(400).send('Authorization code not found.');
        }

        try {
            const tokenResponse = await axios.post('https://www.strava.com/api/v3/oauth/token', {
                client_id: STRAVA_CLIENT_ID,
                client_secret: STRAVA_CLIENT_SECRET,
                code: code,
                grant_type: 'authorization_code'
            });

            const { access_token, refresh_token, expires_at, athlete } = tokenResponse.data;
            
            // Store tokens and athlete info in session
            req.session.strava_access_token = access_token;
            req.session.strava_refresh_token = refresh_token;
            req.session.strava_expires_at = expires_at;
            req.session.strava_athlete = athlete;
            
            console.log('Strava token obtained successfully for athlete:', athlete.id);
            res.redirect('/'); // Redirect to home page after successful auth

        } catch (error) {
            console.error('Error exchanging Strava code for token:', error.response ? error.response.data : error.message);
            res.status(500).send('Failed to authenticate with Strava.');
        }
    });

    // --- API Proxy Routes (to use the access token) ---
    app.get('/api/strava/activities', async (req, res) => {
        if (!req.session.strava_access_token) {
            return res.status(401).json({ error: 'Not authenticated with Strava. Please login.' });
        }

        // Check if token needs refreshing (simplified check for now)
        // A robust implementation would use refresh_token if expires_at is near
        if (Date.now() / 1000 > req.session.strava_expires_at - 300) { // 5 min buffer
            console.log("Strava token might be expired or close to expiring. Implement refresh logic.");
            // For simplicity, we'll just ask to re-auth here. Production would use refresh token.
            // return res.status(401).json({ error: 'Strava token expired. Please re-authenticate.'}); 
        }

        try {
            // Fetch a page of activities, e.g., 30 activities
            const perPage = parseInt(req.query.per_page) || 30;
            const page = parseInt(req.query.page) || 1;

            const activitiesResponse = await axios.get(`https://www.strava.com/api/v3/athlete/activities`, {
                headers: { 'Authorization': `Bearer ${req.session.strava_access_token}` },
                params: { page: page, per_page: perPage }
            });
            res.json(activitiesResponse.data);
        } catch (error) {
            console.error('Error fetching Strava activities:', error.response ? error.response.data : error.message);
            if (error.response && error.response.status === 401) {
                 // Token might have been revoked or truly expired
                req.session.destroy(); // Clear session
                return res.status(401).json({ error: 'Strava authentication error. Please re-login.'});
            }
            res.status(500).json({ error: 'Failed to fetch Strava activities.' });
        }
    });

    // Route to get activity stream (detailed points)
    app.get('/api/strava/activity/:id/streams', async (req, res) => {
        if (!req.session.strava_access_token) {
            return res.status(401).json({ error: 'Not authenticated. Please login.' });
        }
        const activityId = req.params.id;
        try {
            const streamResponse = await axios.get(`https://www.strava.com/api/v3/activities/${activityId}/streams`, {
                headers: { 'Authorization': `Bearer ${req.session.strava_access_token}` },
                params: { keys: 'latlng,time,distance,altitude', key_by_type: true } // Request latlng, time, etc.
            });
            res.json(streamResponse.data);
        } catch (error) {
            console.error(`Error fetching streams for activity ${activityId}:`, error.response ? error.response.data : error.message);
            res.status(500).json({ error: 'Failed to fetch activity streams.' });
        }
    });


    app.get('/api/auth/status', (req, res) => {
        if (req.session.strava_access_token && req.session.strava_athlete) {
            res.json({
                authenticated: true,
                athlete: {
                    firstname: req.session.strava_athlete.firstname,
                    lastname: req.session.strava_athlete.lastname,
                    profile: req.session.strava_athlete.profile_medium
                }
            });
        } else {
            res.json({ authenticated: false });
        }
    });

    app.get('/logout', (req, res) => {
        req.session.destroy(err => {
            if (err) {
                return res.status(500).send('Could not log out.');
            }
            res.redirect('/');
        });
    });


    // Serve the main HTML file for any other GET request
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    app.listen(port, () => {
        console.log(`Server listening at http://localhost:${port}`);
        console.log('Ensure your Strava App Callback Domain is set to localhost and Redirect URI includes the port if non-standard.');
        console.log(`Strava Client ID: ${STRAVA_CLIENT_ID ? 'Loaded' : 'MISSING!'}`);
        console.log(`Strava Client Secret: ${STRAVA_CLIENT_SECRET ? 'Loaded' : 'MISSING!'}`);
    });
    ```

6.  **Create `public` folder and subfolders:**
    ```bash
    mkdir public
    mkdir public/lib
    ```

7.  **Download `regl`:**
    *   Go to [https://github.com/regl-project/regl/releases](https://github.com/regl-project/regl/releases)
    *   Download the latest `regl.min.js` (or `regl.js` for development).
    *   Place it in `public/lib/regl.min.js`.

---

**Step 2: Frontend HTML (`public/index.html`)**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Strava Origin Visualization (WebGL)</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div id="auth-status">
        <button id="loginButton">Login with Strava</button>
        <div id="userInfo" style="display:none;">
            <img id="userProfilePic" src="" alt="Profile" style="width:30px; height:30px; border-radius:50%;">
            <span id="userName"></span>
            <button id="logoutButton">Logout</button>
        </div>
    </div>

    <div id="controls">
        <button id="loadActivitiesButton" disabled>Load Activities</button>
        <span id="loadingMessage" style="display:none;">Loading...</span>
        <fieldset>
            <legend>Activity Types</legend>
            <div id="activity-toggles">
                <!-- Toggles will be dynamically added here -->
            </div>
        </fieldset>
        <button id="resetViewButton">Reset View</button>
         <!-- <button id="recalculateOverlapButton">Recalculate Overlap (Debug)</button> -->
    </div>

    <div id="canvas-container">
        <!-- Canvas will be created by regl -->
    </div>

    <div id="popup">
        <!-- Pop-up content here -->
    </div>

    <script src="/lib/regl.min.js"></script>
    <!-- Polyline decoding library (optional, if Strava gives encoded polylines and you don't want to fetch streams for all) -->
    <!-- <script src="https://unpkg.com/@mapbox/polyline@1.1.1/src/polyline.js"></script> -->
    <script src="app.js"></script>
</body>
</html>
```

---

**Step 3: Frontend CSS (`public/style.css`)**

```css
/* public/style.css */
body {
    font-family: sans-serif;
    margin: 0;
    display: flex;
    flex-direction: column;
    height: 100vh;
    background-color: #f0f0f0;
}

#auth-status {
    padding: 10px;
    background-color: #ddd;
    border-bottom: 1px solid #ccc;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

#userInfo img { margin-right: 8px; vertical-align: middle;}

#controls {
    padding: 10px;
    background-color: #eee;
    border-bottom: 1px solid #ccc;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 15px;
}

#controls fieldset {
    border: 1px solid #ccc;
    padding: 5px 10px;
}

#controls legend {
    font-size: 0.9em;
    font-weight: bold;
}

#canvas-container {
    flex-grow: 1;
    position: relative;
    overflow: hidden;
    background-color: white; /* WebGL background can be set via clear color */
}

/* Regl creates its own canvas, ensure it fills the container */
#canvas-container canvas {
    display: block;
    width: 100%;
    height: 100%;
}


#popup {
    position: absolute;
    background-color: rgba(255, 255, 255, 0.95);
    border: 1px solid #aaa;
    border-radius: 5px;
    padding: 10px;
    box-shadow: 2px 2px 5px rgba(0, 0, 0, 0.2);
    display: none;
    pointer-events: none;
    font-size: 0.9em;
    max-width: 300px;
    word-wrap: break-word;
    z-index: 1000;
}

#popup h3 { margin-top: 0; }
#popup p { margin: 5px 0; }

#loadingMessage.visible { display: inline-block !important; margin-left: 10px; color: #333; }
```

---

**Step 4: Frontend JavaScript (`public/app.js`) - The Core Logic**

This file will be large. I'll structure it and provide key parts.

```javascript
// public/app.js
document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const loginButton = document.getElementById('loginButton');
    const logoutButton = document.getElementById('logoutButton');
    const userInfoDiv = document.getElementById('userInfo');
    const userProfilePic = document.getElementById('userProfilePic');
    const userNameSpan = document.getElementById('userName');
    
    const loadActivitiesButton = document.getElementById('loadActivitiesButton');
    const loadingMessageSpan = document.getElementById('loadingMessage');
    const activityTogglesContainer = document.getElementById('activity-toggles');
    const resetViewButton = document.getElementById('resetViewButton');
    const canvasContainer = document.getElementById('canvas-container');
    const popupElement = document.getElementById('popup');

    // --- Regl Setup ---
    let regl; // Initialize after checking auth
    let drawTracksCommand;

    // --- Configuration ---
    const NO_OVERLAP_TRACK_COLOR_RGB = [0, 0, 0];     // Black [R, G, B] (0-1 range for shader)
    const MAX_OVERLAP_TRACK_COLOR_RGB = [1, 0, 0];   // Red   [R, G, B]
    
    const NON_OVERLAP_THICKNESS = 2.0; // pixels
    const MIN_OVERLAP_THICKNESS_START = 4.0;
    const MAX_OVERLAP_THICKNESS = 20.0;
    
    const MIN_OVERLAPS_FOR_EFFECT_START = 2;
    const MAX_OVERLAPS_FOR_FULL_EFFECT = 5;

    const OVERLAP_PROXIMITY_ABSTRACT = 10; // Proximity in abstract scaled units
    const GLOBAL_SCALE = 50000; // Similar to before, for lat/lon diffs
    const CLICK_SENSITIVITY_PIXELS = 10;

    // --- Global State ---
    let allTracksData = []; // Processed track data for WebGL
    let activityMetadata = new Map(); // Store metadata by track ID (original Strava ID)
    let activityTypes = new Set();
    let activeActivityFilters = {};

    let viewState = {
        centerX: 0.0, // Abstract world coords
        centerY: 0.0,
        scale: 1.0,   // Zoom level
        panX: 0,      // Screen space pan offset (applied after scaling around center)
        panY: 0
    };
    let initialViewState = {};

    let isPanning = false;
    let lastPanCanvasPosition = { x: 0, y: 0 };

    // Grid for overlap detection
    let pointPresenceGrid = new Map();
    const GRID_CELL_SIZE = OVERLAP_PROXIMITY_ABSTRACT;


    // ========================================================================
    // AUTHENTICATION & INITIALIZATION
    // ========================================================================
    async function checkAuthStatus() {
        try {
            const response = await fetch('/api/auth/status');
            const data = await response.json();
            if (data.authenticated) {
                loginButton.style.display = 'none';
                userInfoDiv.style.display = 'flex'; // Use flex for better alignment
                userNameSpan.textContent = `${data.athlete.firstname} ${data.athlete.lastname}`;
                userProfilePic.src = data.athlete.profile;
                loadActivitiesButton.disabled = false;
                initializeRegl(); // Initialize WebGL components now
            } else {
                loginButton.style.display = 'block';
                userInfoDiv.style.display = 'none';
                loadActivitiesButton.disabled = true;
            }
        } catch (error) {
            console.error('Error checking auth status:', error);
        }
    }

    loginButton.addEventListener('click', () => {
        window.location.href = '/strava/authorize';
    });
    logoutButton.addEventListener('click', () => {
        window.location.href = '/logout';
    });

    function initializeRegl() {
        if (regl) return; // Already initialized

        regl = createREGL({ 
            container: canvasContainer,
            attributes: { antialias: true } // Enable antialiasing if supported
        });

        // Define default view state centered in the canvas
        const canvas = regl._gl.canvas;
        initialViewState = {
            centerX: 0.0,
            centerY: 0.0,
            scale: 1.0,
            panX: canvas.width / 2,
            panY: canvas.height / 2,
        };
        viewState = { ...initialViewState };
        
        setupWebGLCommands();
        setupInteractions();
        regl.frame(renderLoop); // Start render loop
    }


    // ========================================================================
    // DATA FETCHING AND PROCESSING
    // ========================================================================
    loadActivitiesButton.addEventListener('click', async () => {
        if (!regl) {
            alert("WebGL not initialized. Please ensure you are logged in.");
            return;
        }
        loadingMessageSpan.style.display = 'inline-block';
        loadActivitiesButton.disabled = true;

        allTracksData = [];
        activityMetadata.clear();
        activityTypes.clear();
        pointPresenceGrid.clear();
        activeActivityFilters = {}; // Reset filters

        try {
            // Fetch a list of activities (summary)
            const activitiesResponse = await fetch('/api/strava/activities?per_page=50'); // Load 50 activities
            if (!activitiesResponse.ok) throw new Error(`Failed to fetch activities: ${activitiesResponse.statusText}`);
            const activities = await activitiesResponse.json();

            if (!activities || activities.length === 0) {
                alert("No activities found.");
                return;
            }
            
            const streamPromises = activities.map(async (activity) => {
                // We need latlng streams for detailed track shapes
                if (!activity.map || !activity.map.summary_polyline) { // Skip activities without polylines
                    console.warn(`Skipping activity ${activity.id} (${activity.name}) as it has no summary_polyline.`);
                    return null; 
                }
                try {
                    const streamRes = await fetch(`/api/strava/activity/${activity.id}/streams`);
                    if (!streamRes.ok) {
                        console.error(`Failed to fetch streams for activity ${activity.id}: ${streamRes.statusText}`);
                        return null; // Skip this activity on error
                    }
                    const streams = await streamRes.json();
                    if (streams && streams.latlng && streams.latlng.data) {
                        return { activityInfo: activity, latlngStream: streams.latlng.data, timeStream: streams.time?.data, distStream: streams.distance?.data };
                    } else {
                        console.warn(`No latlng stream data for activity ${activity.id}`);
                        return null;
                    }
                } catch (streamErr) {
                    console.error(`Error in stream fetch promise for ${activity.id}:`, streamErr);
                    return null;
                }
            });

            const resolvedStreams = (await Promise.all(streamPromises)).filter(s => s !== null);

            processStravaData(resolvedStreams);
            updateActivityToggles();
            calculateAllSegmentOverlaps();
            prepareDataForWebGL();
            resetViewAndFitTracks();

        } catch (error) {
            console.error('Error loading Strava activities:', error);
            alert('Error loading activities. Check console for details.');
        } finally {
            loadingMessageSpan.style.display = 'none';
            loadActivitiesButton.disabled = false;
        }
    });

    function processStravaData(streamDataArray) {
        // streamDataArray is [{ activityInfo, latlngStream, timeStream, distStream }, ...]
        streamDataArray.forEach(({ activityInfo, latlngStream, timeStream, distStream }, index) => {
            if (!latlngStream || latlngStream.length < 2) return;

            const originalPoints = latlngStream.map(p => ({ lat: p[0], lon: p[1] }));
            
            // Translate to origin (0,0) and scale
            const firstPoint = originalPoints[0];
            const translatedScaledPoints = originalPoints.map(p => ({
                x: (p.lon - firstPoint.lon) * GLOBAL_SCALE,
                y: -(p.lat - firstPoint.lat) * GLOBAL_SCALE // Invert Y
            }));

            const trackId = activityInfo.id; // Use Strava's activity ID
            
            activityMetadata.set(trackId, {
                id: trackId,
                name: activityInfo.name,
                type: activityInfo.type.toLowerCase(), // Strava types: Run, Ride, Swim, etc.
                date: new Date(activityInfo.start_date_local).toLocaleString(),
                distance: activityInfo.distance, // meters
                movingTime: activityInfo.moving_time, // seconds
                elapsedTime: activityInfo.elapsed_time,
                totalElevationGain: activityInfo.total_elevation_gain,
                // Add more as needed
            });
            activityTypes.add(activityInfo.type.toLowerCase());

            // Store for overlap detection (using abstract scaled points)
            // We'll build the final WebGL buffers later
            const trackForOverlap = {
                id: trackId, // Strava activity ID
                internalId: index, // Internal sequential ID for grid
                type: activityInfo.type.toLowerCase(),
                translatedPoints: translatedScaledPoints,
                segmentsWithOverlap: [] // To be filled
            };
            allTracksData.push(trackForOverlap); // Temporarily store for overlap processing


            // Populate pointPresenceGrid for overlap detection
            translatedScaledPoints.forEach(tp => {
                const gridX = Math.floor(tp.x / GRID_CELL_SIZE);
                const gridY = Math.floor(tp.y / GRID_CELL_SIZE);
                const key = `${gridX}_${gridY}`;
                if (!pointPresenceGrid.has(key)) {
                    pointPresenceGrid.set(key, new Set());
                }
                pointPresenceGrid.get(key).add(trackForOverlap.internalId); // Use internal ID for grid
            });
        });
        console.log(`Processed ${allTracksData.length} tracks for overlap detection.`);
    }

    function calculateAllSegmentOverlaps() {
        // This function is very similar to the previous GPX version
        allTracksData.forEach(track => { // This iterates over the temporary `allTracksData`
            if (!track.translatedPoints || track.translatedPoints.length < 2) {
                track.segmentsWithOverlap = [];
                return;
            }
            track.segmentsWithOverlap = []; // Clear previous if any
            for (let i = 0; i < track.translatedPoints.length - 1; i++) {
                const p1 = track.translatedPoints[i];
                const p2 = track.translatedPoints[i+1];
                const midpoint = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
                
                // Pass track.internalId for the grid check
                const overlapCount = getOverlapCountForPoint(midpoint, track.internalId); 
                track.segmentsWithOverlap.push({ p1, p2, overlapCount });
            }
        });
        console.log("Segment overlaps calculated.");
    }
    
    function getOverlapCountForPoint(abstractScaledPoint, currentTrackInternalId) {
        // Similar to GPX version, uses currentTrackInternalId
        const gridX = Math.floor(abstractScaledPoint.x / GRID_CELL_SIZE);
        const gridY = Math.floor(abstractScaledPoint.y / GRID_CELL_SIZE);
        let uniqueTrackInternalIdsInVicinity = new Set();

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const key = `${gridX + dx}_${gridY + dy}`;
                if (pointPresenceGrid.has(key)) {
                    pointPresenceGrid.get(key).forEach(trackInternalId => {
                         // Only count if it's a different track
                        // if (trackInternalId !== currentTrackInternalId) { // This logic is subtle.
                        // The original intent was "how many tracks share this space",
                        // so including the current track in the count is correct.
                        uniqueTrackInternalIdsInVicinity.add(trackInternalId);
                        // }
                    });
                }
            }
        }
        return uniqueTrackInternalIdsInVicinity.size;
    }

    let webGLTrackBuffers = { positions: [], colors: [], thicknesses: [], indices: [], segmentTrackIds: [] };

    function prepareDataForWebGL() {
        webGLTrackBuffers = { positions: [], colors: [], thicknesses: [], indices: [], segmentTrackIds: [] };
        let currentIndex = 0;

        allTracksData.forEach(track => { // This is the temporary allTracksData
            if (!activeActivityFilters[track.type] || !track.segmentsWithOverlap) return;

            track.segmentsWithOverlap.forEach(segment => {
                const { p1, p2, overlapCount } = segment;
                
                let thickness, colorRGB;

                if (overlapCount <= 1) {
                    thickness = NON_OVERLAP_THICKNESS;
                    colorRGB = NO_OVERLAP_TRACK_COLOR_RGB.map(c => c); // Copy
                } else {
                    let thicknessRatio = 0;
                    if (MAX_OVERLAPS_FOR_FULL_EFFECT > MIN_OVERLAPS_FOR_EFFECT_START) {
                        thicknessRatio = Math.min(1, Math.max(0,
                            (overlapCount - MIN_OVERLAPS_FOR_EFFECT_START) /
                            (MAX_OVERLAPS_FOR_FULL_EFFECT - MIN_OVERLAPS_FOR_EFFECT_START)
                        ));
                    } else if (overlapCount >= MAX_OVERLAPS_FOR_FULL_EFFECT) {
                        thicknessRatio = 1;
                    }
                    thickness = MIN_OVERLAP_THICKNESS_START + thicknessRatio * (MAX_OVERLAP_THICKNESS - MIN_OVERLAP_THICKNESS_START);
                    thickness = Math.min(MAX_OVERLAP_THICKNESS, Math.max(MIN_OVERLAP_THICKNESS_START, thickness));

                    const colorFadeStartReferenceCount = 1;
                    let colorRatio = 0;
                    if (MAX_OVERLAPS_FOR_FULL_EFFECT > colorFadeStartReferenceCount) {
                         colorRatio = Math.min(1, Math.max(0,
                            (overlapCount - colorFadeStartReferenceCount) /
                            (MAX_OVERLAPS_FOR_FULL_EFFECT - colorFadeStartReferenceCount)
                        ));
                    } else if (overlapCount >= MAX_OVERLAPS_FOR_FULL_EFFECT) {
                        colorRatio = 1;
                    }
                    
                    colorRGB = [
                        NO_OVERLAP_TRACK_COLOR_RGB[0] + colorRatio * (MAX_OVERLAP_TRACK_COLOR_RGB[0] - NO_OVERLAP_TRACK_COLOR_RGB[0]),
                        NO_OVERLAP_TRACK_COLOR_RGB[1] + colorRatio * (MAX_OVERLAP_TRACK_COLOR_RGB[1] - NO_OVERLAP_TRACK_COLOR_RGB[1]),
                        NO_OVERLAP_TRACK_COLOR_RGB[2] + colorRatio * (MAX_OVERLAP_TRACK_COLOR_RGB[2] - NO_OVERLAP_TRACK_COLOR_RGB[2]),
                    ];
                }

                // For gl.LINES, each segment needs two points
                webGLTrackBuffers.positions.push(p1.x, p1.y, p2.x, p2.y);
                // Each vertex gets the segment's color and thickness
                webGLTrackBuffers.colors.push(...colorRGB, ...colorRGB);
                webGLTrackBuffers.thicknesses.push(thickness, thickness);
                webGLTrackBuffers.indices.push(currentIndex, currentIndex + 1);
                webGLTrackBuffers.segmentTrackIds.push(track.id, track.id); // Store original Strava track ID for picking
                currentIndex += 2;
            });
        });
        // console.log("WebGL data prepared:", webGLTrackBuffers.positions.length / 2, "vertices");
    }


    // ========================================================================
    // WEBGL RENDERING (using regl)
    // ========================================================================
    function setupWebGLCommands() {
        const vertShader = `
            precision mediump float;
            attribute vec2 position;
            attribute vec3 color;      // R, G, B
            attribute float thickness; // Will be used for gl_PointSize if drawing points, or gl_LineWidth

            uniform mat4 projection;
            uniform mat4 view;
            
            varying vec3 vColor;
            varying float vThickness;

            void main() {
                gl_Position = projection * view * vec4(position, 0.0, 1.0);
                // gl_PointSize = thickness; // If drawing points, otherwise gl_LineWidth for lines
                vColor = color;
                vThickness = thickness; // Pass to fragment shader if needed, or just use here
            }`;

        const fragShader = `
            precision mediump float;
            varying vec3 vColor;
            // varying float vThickness; // Not directly used for line color here

            void main() {
                gl_FragColor = vec4(vColor, 1.0);
            }`;

        drawTracksCommand = regl({
            vert: vertShader,
            frag: fragShader,
            attributes: {
                position: regl.prop('positions'), // expects a regl buffer or typed array
                color: regl.prop('colors'),
                thickness: regl.prop('thicknesses') // This is custom, not directly used by gl.LINES for thickness
            },
            uniforms: {
                projection: ({viewportWidth, viewportHeight}) => {
                    // Simple orthographic projection
                    // This assumes your "world" coordinates (after GLOBAL_SCALE) are somewhat reasonable
                    const left = 0;
                    const right = viewportWidth;
                    const bottom = viewportHeight;
                    const top = 0;
                    const near = -1;
                    const far = 1;
                    return [
                        2 / (right - left), 0, 0, 0,
                        0, 2 / (top - bottom), 0, 0,
                        0, 0, -2 / (far - near), 0,
                        -(right + left) / (right - left), -(top + bottom) / (top - bottom), -(far + near) / (far - near), 1
                    ];
                },
                view: () => {
                    // Applies pan and zoom
                    // viewState.centerX, centerY are the world point that should be at the center of the view
                    // viewState.scale is the zoom level
                    // viewState.panX, panY are screen-space offsets applied *after* scaling around the center
                    
                    // 1. Translate so (centerX, centerY) is at origin
                    // 2. Scale
                    // 3. Translate back by canvas center (viewState.panX, viewState.panY)

                    const s = viewState.scale;
                    // Translate world origin to where panX, panY is on screen
                    // then scale around that point.
                    // The abstract origin (0,0) should appear at viewState.panX, viewState.panY on screen
                    // before scaling is applied around that point.
                    
                    // Matrix that translates (0,0) world to (panX, panY) screen, then scales
                    return [
                        s, 0, 0, 0,
                        0, s, 0, 0,
                        0, 0, 1, 0,
                        viewState.panX * s, viewState.panY * s, 0, 1 // This needs to be adjusted.
                                                                 // The view matrix transforms world coords to view coords.
                                                                 // panX/Y are the screen coords of the world origin (0,0)
                                                                 // view should map (0,0) world to (panX, panY) screen, then scale around it
                    ];
                }
            },
            // For gl.LINES, elements define pairs of vertices to connect
            elements: regl.prop('indices'),
            primitive: 'lines',
            // count: regl.prop('count') // Handled by elements length
            
            // lineWidth: (context, props) => {
            //     // THIS IS COMPLICATED. gl.lineWidth is often limited (e.g. to 1.0 on some systems).
            //     // To get variable thickness lines robustly, you need to render lines as quads (triangles).
            //     // For now, we'll try using a single lineWidth for all, or accept its limitations.
            //     // We can use the *average* thickness or a representative one.
            //     // Or, if we process data into multiple draw calls by thickness.
            //     // Let's use a simple approach first, and rely on color for overlap emphasis.
            //     // The 'thickness' attribute isn't directly used by `gl.LINES` primitive for width.
            //     // `gl.lineWidth` is a global state.
            //     // A more advanced approach is to pass thickness to vertex shader, expand to quads.
            //     // For simplicity: if (props.baseThickness) return props.baseThickness;
            //     return NON_OVERLAP_THICKNESS; // Fallback
            // }
            // Instead of lineWidth in command, set it in the render loop based on average or something.
        });
    }
    
    function renderLoop() {
        regl.poll(); // Important for resizing and input events
        regl.clear({
            color: [1, 1, 1, 1], // White background
            depth: 1
        });

        if (webGLTrackBuffers.positions && webGLTrackBuffers.positions.length > 0 && drawTracksCommand) {
            // Create/update regl buffers if data changed
            // Note: For performance, you'd typically create buffers once and update them,
            // or use regl's dynamic properties if data changes frequently per frame.
            // Here, we recreate if the underlying array reference changes or for simplicity.

            // The current `drawTracksCommand` setup expects properties to be passed each call.
            // These properties should be regl buffers or compatible arrays.
            
            // For gl.lineWidth - it's a global state. We can't easily vary it per segment with gl.LINES
            // We will rely on color for overlap.
            // If you wanted varied thickness, you'd need to draw lines as series of quads.
            // We can try to set it based on non-overlapping thickness:
            regl._gl.lineWidth(NON_OVERLAP_THICKNESS); // Sets a global line width. May not be very effective.

            drawTracksCommand({
                positions: regl.buffer(webGLTrackBuffers.positions),
                colors: regl.buffer(webGLTrackBuffers.colors),
                thicknesses: regl.buffer(webGLTrackBuffers.thicknesses), // Not directly used by gl.LINES
                indices: regl.elements(webGLTrackBuffers.indices)
            });
        }
    }

    // ========================================================================
    // INTERACTIVITY (Zoom, Pan, Toggles, Popup)
    // ========================================================================
    function setupInteractions() {
        const canvas = regl._gl.canvas;

        // Zoom
        canvas.addEventListener('wheel', (event) => {
            event.preventDefault();
            const zoomFactor = 1.1;
            const scaleAmount = event.deltaY < 0 ? zoomFactor : 1 / zoomFactor;
            
            const rect = canvas.getBoundingClientRect();
            const mouseX = event.clientX - rect.left; // Mouse X relative to canvas
            const mouseY = event.clientY - rect.top;  // Mouse Y relative to canvas

            // Convert mouse screen coords to world coords before zoom
            // World_x = (Screen_x - Pan_x) / Scale
            const worldXBeforeZoom = (mouseX - viewState.panX) / viewState.scale;
            const worldYBeforeZoom = (mouseY - viewState.panY) / viewState.scale;

            viewState.scale *= scaleAmount;
            viewState.scale = Math.max(0.01, Math.min(viewState.scale, 100)); // Zoom limits

            // New pan so the world point under mouse remains under mouse
            // Pan_x = Screen_x - World_x_scaled
            viewState.panX = mouseX - worldXBeforeZoom * viewState.scale;
            viewState.panY = mouseY - worldYBeforeZoom * viewState.scale;
            
            // No need to call draw explicitly, regl.frame handles it.
        });

        // Pan
        canvas.addEventListener('mousedown', (event) => {
            if (event.button !== 0) return;
            isPanning = true;
            lastPanCanvasPosition = { x: event.clientX, y: event.clientY };
            canvas.style.cursor = 'grabbing';
        });
        canvas.addEventListener('mousemove', (event) => {
            if (!isPanning) return;
            const dx = event.clientX - lastPanCanvasPosition.x;
            const dy = event.clientY - lastPanCanvasPosition.y;
            
            viewState.panX += dx;
            viewState.panY += dy;
            
            lastPanCanvasPosition = { x: event.clientX, y: event.clientY };
        });
        canvas.addEventListener('mouseup', () => {
            if (isPanning) {
                isPanning = false;
                canvas.style.cursor = 'grab';
            }
        });
        canvas.addEventListener('mouseleave', () => {
            if (isPanning) {
                isPanning = false;
                canvas.style.cursor = 'grab';
            }
        });

        resetViewButton.addEventListener('click', () => {
            // If initialViewState was set after data load to fit tracks, this will work.
            // Otherwise, it resets to the initial centered view.
            viewState = { ...initialViewState }; 
            if (allTracksData.length > 0 && !webGLTrackBuffers.positions.length) {
                // If data is loaded but not yet in WebGL buffers (e.g. filters changed)
                prepareDataForWebGL(); // Ensure WebGL buffers are up-to-date
            }
        });

        // Click for Popup (Track Selection)
        canvas.addEventListener('click', handleCanvasClickForPopup);
    }

    function updateActivityToggles() {
        activityTogglesContainer.innerHTML = '';
        const sortedTypes = Array.from(activityTypes).sort();
        
        sortedTypes.forEach(type => {
            if (!activeActivityFilters.hasOwnProperty(type)) {
                activeActivityFilters[type] = true; // Default to visible
            }

            const label = document.createElement('label');
            label.style.marginRight = '10px';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = activeActivityFilters[type];
            checkbox.dataset.type = type;
            checkbox.addEventListener('change', (event) => {
                activeActivityFilters[type] = event.target.checked;
                // Re-filter and prepare data for WebGL
                prepareDataForWebGL();
                // Render loop will pick up changes
            });
            
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(` ${type.charAt(0).toUpperCase() + type.slice(1)}`));
            activityTogglesContainer.appendChild(label);
        });
        if (sortedTypes.length === 0) {
             activityTogglesContainer.textContent = "No activities to filter.";
        }
    }
    
    function resetViewAndFitTracks() {
        if (!regl || allTracksData.length === 0) {
            viewState = { ...initialViewState }; // Reset to default if no data
            return;
        }
    
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        let hasPoints = false;
    
        // Use allTracksData which contains the translatedPoints for all loaded tracks
        allTracksData.forEach(track => {
            // Consider all tracks for bounding box, not just currently filtered ones for initial fit
            if (track.translatedPoints && track.translatedPoints.length > 0) {
                track.translatedPoints.forEach(p => {
                    minX = Math.min(minX, p.x);
                    maxX = Math.max(maxX, p.x);
                    minY = Math.min(minY, p.y);
                    maxY = Math.max(maxY, p.y);
                    hasPoints = true;
                });
            }
        });
    
        if (!hasPoints) {
            viewState = { ...initialViewState };
            return;
        }
    
        const dataWidth = maxX - minX;
        const dataHeight = maxY - minY;
        const canvas = regl._gl.canvas;
    
        if (dataWidth === 0 && dataHeight === 0) { // Single point or all tracks are single points
             viewState = { ...initialViewState }; // Use default zoom
             viewState.panX = canvas.width / 2 - minX * viewState.scale; // Center the single point
             viewState.panY = canvas.height / 2 - minY * viewState.scale;
             initialViewState = {...viewState}; // Update also the stored initial for future resets
             return;
        }

        const padding = 50; // pixels
        const canvasPaddedWidth = canvas.width - 2 * padding;
        const canvasPaddedHeight = canvas.height - 2 * padding;

        const scaleX = dataWidth > 0 ? canvasPaddedWidth / dataWidth : 1;
        const scaleY = dataHeight > 0 ? canvasPaddedHeight / dataHeight : 1;
        
        viewState.scale = Math.min(scaleX, scaleY, 5); 
        viewState.scale = Math.max(viewState.scale, 0.01); 
    
        // The point that should be at the center of the screen is the center of the data's bounding box
        const dataCenterX = minX + dataWidth / 2;
        const dataCenterY = minY + dataHeight / 2;
    
        // We want dataCenterX, dataCenterY (world coords) to appear at canvas.width/2, canvas.height/2 (screen coords)
        // panX = ScreenTargetX - WorldTargetX * scale
        // panY = ScreenTargetY - WorldTargetY * scale
        viewState.panX = canvas.width / 2 - dataCenterX * viewState.scale;
        viewState.panY = canvas.height / 2 - dataCenterY * viewState.scale;

        initialViewState = { ...viewState }; // Store this fitted view as the new "initial" for reset
    }

    function handleCanvasClickForPopup(event) {
        if (isPanning) return; // Don't select if it was part of a pan
        if (!regl || !webGLTrackBuffers.positions || webGLTrackBuffers.positions.length === 0) return;

        const canvas = regl._gl.canvas;
        const rect = canvas.getBoundingClientRect();
        const clickX_screen = event.clientX - rect.left;
        const clickY_screen = event.clientY - rect.top;

        // Convert screen click to world coordinates
        const clickX_world = (clickX_screen - viewState.panX) / viewState.scale;
        const clickY_world = (clickY_screen - viewState.panY) / viewState.scale;

        let bestMatch = { trackId: null, distance: Infinity };
        const sensitivityInWorld = CLICK_SENSITIVITY_PIXELS / viewState.scale;

        // Iterate through the segments in webGLTrackBuffers
        for (let i = 0; i < webGLTrackBuffers.indices.length; i += 2) {
            const idx1 = webGLTrackBuffers.indices[i];   // This is vertex index, not position array index
            const idx2 = webGLTrackBuffers.indices[i+1];

            const p1 = { x: webGLTrackBuffers.positions[idx1 * 2], y: webGLTrackBuffers.positions[idx1 * 2 + 1] };
            const p2 = { x: webGLTrackBuffers.positions[idx2 * 2], y: webGLTrackBuffers.positions[idx2 * 2 + 1] };
            
            // Check if this segment belongs to a visible track type
            const segmentTrackId = webGLTrackBuffers.segmentTrackIds[idx1]; // Both vertices of a segment have same track ID
            const trackMeta = activityMetadata.get(segmentTrackId);
            if (trackMeta && !activeActivityFilters[trackMeta.type]) {
                continue; // Skip segments of filtered out tracks
            }

            const dist = distancePointToSegment( { x: clickX_world, y: clickY_world }, p1, p2);

            if (dist < sensitivityInWorld && dist < bestMatch.distance) {
                bestMatch = { trackId: segmentTrackId, distance: dist };
            }
        }

        if (bestMatch.trackId) {
            const trackInfo = activityMetadata.get(bestMatch.trackId);
            if (trackInfo) showPopup(trackInfo, event.clientX, event.clientY);
        } else {
            hidePopup();
        }
    }

    function distancePointToSegment(p, a, b) { // p, a, b are {x, y}
        const l2 = (a.x - b.x)**2 + (a.y - b.y)**2;
        if (l2 === 0) return Math.sqrt((p.x - a.x)**2 + (p.y - a.y)**2);
        let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        const projectionX = a.x + t * (b.x - a.x);
        const projectionY = a.y + t * (b.y - a.y);
        return Math.sqrt((p.x - projectionX)**2 + (p.y - projectionY)**2);
    }

    function showPopup(track, mouseX, mouseY) {
        let content = `<h3>${track.name}</h3>`;
        content += `<p><strong>Type:</strong> ${track.type.charAt(0).toUpperCase() + track.type.slice(1)}</p>`;
        content += `<p><strong>Date:</strong> ${track.date}</p>`;
        content += `<p><strong>Distance:</strong> ${(track.distance / 1000).toFixed(2)} km</p>`;
        content += `<p><strong>Moving Time:</strong> ${formatDuration(track.movingTime)}</p>`;
        if(track.totalElevationGain) content += `<p><strong>Elevation Gain:</strong> ${track.totalElevationGain.toFixed(0)} m</p>`;
        // Add more details as needed

        popupElement.innerHTML = content;
        popupElement.style.display = 'block';
        
        const popupRect = popupElement.getBoundingClientRect();
        let top = mouseY + 15;
        let left = mouseX + 15;

        if (left + popupRect.width > window.innerWidth) left = mouseX - popupRect.width - 15;
        if (top + popupRect.height > window.innerHeight) top = mouseY - popupRect.height - 15;
        popupElement.style.left = `${Math.max(0, left)}px`;
        popupElement.style.top = `${Math.max(0, top)}px`;
    }

    function hidePopup() {
        popupElement.style.display = 'none';
    }

    function formatDuration(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        let str = "";
        if (h > 0) str += `${h}h `;
        if (m > 0 || h > 0) str += `${m}m `; // show minutes if hours exist
        str += `${s}s`;
        return str.trim();
    }

    // --- Initial Load ---
    checkAuthStatus(); // Check auth and initialize if logged in
    canvasContainer.style.cursor = 'grab'; // Initial cursor
});
```

**Important Notes on `app.js` (Frontend):**

*   **Polyline Decoding:** The Strava API `summary_polyline` is encoded. You'll need a library to decode it (like `@mapbox/polyline`) if you choose to use summary polylines instead of fetching full streams for every activity. My example fetches streams for `latlng`.
*   **WebGL Line Thickness:** As mentioned, `gl.LINES` has limited support for `gl.lineWidth`. True variable thickness requires rendering lines as sequences of quads (two triangles per line segment). This involves more complex vertex shaders to expand points based on thickness and orientation. The current example primarily uses *color* to indicate overlap intensity and sets a global `gl.lineWidth` which might only affect non-overlapping lines.
*   **Projection & View Matrices:** The math for these is crucial for zoom and pan. The `view` matrix in `drawTracksCommand` needs careful implementation to correctly map world coordinates to screen based on `viewState`. The provided example is a starting point.
*   **Data for WebGL:** Data needs to be flattened into typed arrays for WebGL buffers (`Float32Array` for positions/colors, `Uint16Array` or `Uint32Array` for indices). `regl` can often handle plain arrays too.
*   **Performance:** For many tracks, consider:
    *   Optimizing JavaScript processing.
    *   Using Web Workers for data processing.
    *   Efficiently updating WebGL buffers instead of recreating them.
    *   More advanced spatial indexing if overlap detection is slow.
*   **Error Handling:** The provided code has basic error handling. Robust applications need more.
*   **Strava Rate Limits:** Be mindful of Strava's API rate limits.

---

**Step 5: Running the Application**

1.  **Open Terminal in VS Code** (`Ctrl + `` or `Cmd + ``).
2.  **Navigate to your project root (`strava-webgl-viz/`)**.
3.  **Start the Backend Server:**
    ```bash
    node server.js
    ```
    You should see: `Server listening at http://localhost:3000`.
4.  **Open your Browser:** Go to `http://localhost:3000`.
5.  **Login with Strava:** Click the button. You'll be redirected to Strava, authorize, and be redirected back.
6.  **Load Activities:** Click the "Load Activities" button.
7.  **Interact:** Zoom, pan, toggle activity types.

---

This is a complex setup. Debugging will likely be necessary. Use your browser's Developer Tools (Console, Network tabs) extensively.

**Further Improvements (Beyond this initial setup):**

*   **Robust Strava Token Refresh:** Implement logic using the `refresh_token` to get new access tokens without requiring user re-login.
*   **WebGL Line Thickness with Quads:** For true variable line thickness.
*   **Framebuffer Picking:** More accurate object selection in WebGL.
*   **Pagination for Activities:** Load more activities as the user scrolls or clicks "load more."
*   **More Detailed Pop-ups.**
*   **Performance Optimizations.**
*   **UI/UX refinements.**

This detailed guide should give you a strong foundation to build your Strava activity visualizer with WebGL! Good luck!
