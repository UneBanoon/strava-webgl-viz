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

    ```see 'server.js'
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

```see 'public/index.html'
```

---

**Step 3: Frontend CSS (`public/style.css`)**

```see 'public/style.css'
```

---

**Step 4: Frontend JavaScript (`public/app.js`) - The Core Logic**

This file will be large. I'll structure it and provide key parts.

```see 'public/app.js'
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
