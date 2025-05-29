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
