// server.js
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const cors = require("cors");
const morgan = require("morgan");

const app = express();
const PORT = process.env.PORT || 8080;
const SESSION_FILE = "session.json";

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// --- AMYBD API Config ---
const API_URL = "https://www.amybd.com/atapi.aspx";
const AMY_USER = process.env.AMY_USER;
const AMY_PASS = process.env.AMY_PASS;
const AMY_DVID = process.env.AMY_DVID;
const AMY_CID = process.env.AMY_CID;

// --- Session Helpers ---
function loadSession() {
    if (fs.existsSync(SESSION_FILE)) {
        return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    }
    return null;
}

function saveSession(data) {
    const tmpFile = SESSION_FILE + ".tmp";
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
    fs.renameSync(tmpFile, SESSION_FILE);
}

// --- Login Function ---
async function login() {
    const payload = {
        USER: AMY_USER,
        PASS: AMY_PASS,
        DVID: AMY_DVID,
        CID: AMY_CID,
        CMND: "_LOGINONLY_",
    };

    const response = await axios.post(API_URL, payload, {
        headers: { "Content-Type": "application/json" },
    });

    if (response.data.success) {
        console.log("✅ Login success!");
        saveSession(response.data);
        return response.data;
    } else {
        throw new Error("❌ Login failed: " + (response.data.message || "Unknown error"));
    }
}

// --- API Request using saved session ---
async function fetchWithSession(payload, allowRetry = true) {
    let session = loadSession();

    if (!session || !session.authid) {
        console.log("No saved session, logging in...");
        session = await login();
    }

    try {
        const response = await axios.post(API_URL, payload, {
            headers: {
                "Content-Type": "application/json",
                "authid": session.authid, // ✅ authid as header
            },
        });

        const sessionExpired =
            response.data.success === false &&
            /login|expired|unauthorized|invalid/i.test(response.data.message || "");

        if (allowRetry && sessionExpired) {
            console.log("⚠️ Session expired, re-logging in...");
            session = await login();
            return fetchWithSession(payload, false);
        }

        return response.data;
    } catch (error) {
        const errMsg = error.response?.data?.message || error.message || "Unknown error";
        console.error("❌ Request failed:", errMsg);
        throw new Error(errMsg);
    }
}

// --- Routes ---
app.post("/login", async (req, res) => {
    try {
        const session = await login();
        res.json({ success: true, session });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get("/balance", async (req, res) => {
    try {
        const data = await fetchWithSession({ CMND: "_GETBALANCE_" });
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get("/airport", async (req, res) => {
    try {
        const { key } = req.query;
        if (!key) return res.status(400).json({ success: false, error: "Missing 'key' query param" });

        const payload = { CMND: "_ROUTEFROM_", dom: 3, pref: 0, skey: key };
        const data = await fetchWithSession(payload);
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post("/flight/oneway", async (req, res) => {
    try {
        const payload = { CMND: "_FLIGHTSEARCHOPEN_", ...req.body, is_combo: 0 };
        const data = await fetchWithSession(payload);
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post("/flight/roundtrip", async (req, res) => {
    try {
        const payload = { CMND: "_FLIGHTSEARCH_", ...req.body, is_combo: 0 };
        const data = await fetchWithSession(payload);
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post("/flight/combo", async (req, res) => {
    try {
        const payload = { CMND: "_FLIGHTCOMBO_", ...req.body, is_combo: 1 };
        const data = await fetchWithSession(payload);
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- Check Session ---
app.get("/checksession", async (req, res) => {
    try {
        const data = await fetchWithSession({ CMND: "_CHKSESSION_" });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- SignalR Ping (direct, not using session) ---
app.get("/ping", async (req, res) => {
    try {
        const response = await axios.get("https://www.amybd.com/laser/signalr/ping", {
            params: { _: Date.now() },
            headers: { "Content-Type": "application/json" }
        });
        res.json({ success: true, data: response.data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- Price Combo ---
app.get("/pricecombo", async (req, res) => {
    try {
        const { sid1, sid2 = 0, aid1, aid2 = "", disp = 1 } = req.query;

        if (!sid1 || !aid1) {
            return res.status(400).json({
                success: false,
                error: "Missing required query params: sid1 and aid1"
            });
        }

        const payload = {
            CMND: "_PRICECOMBO_",
            sid1,
            sid2,
            aid1,
            aid2,
            disp
        };

        const data = await fetchWithSession(payload);
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


app.get("/", (req, res) => {
    res.send("AmyBD Express Proxy is running ✅");
});

// --- Start Server ---
async function startServer() {
    try {
        let session = loadSession();
        if (session?.authid) {
            try {
                await fetchWithSession({ CMND: "_GETBALANCE_" }, false);
                console.log("[Startup] Session validated ✅");
            } catch {
                console.log("[Startup] Session invalid. Logging in again...");
                await login();
            }
        } else {
            console.log("[Startup] No active session found. Logging in...");
            await login();
        }

        app.listen(PORT, () => {
            console.log(`🚀 Server running on http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("[Startup] Failed to initialize session:", error.message);
        app.listen(PORT, () => {
            console.log(`🚀 Server running on http://localhost:${PORT} (login required manually)`);
        });
    }
}

// Graceful shutdown
process.on("SIGINT", () => {
    console.log("🛑 Server shutting down...");
    process.exit(0);
});

startServer();
