require("dotenv").config();
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Store session/auth id
let authId = null;

// --- AMYBD API Config ---
const AMY_USER = process.env.AMY_USER;
const AMY_PASS = process.env.AMY_PASS;
const AMY_DVID = process.env.AMY_DVID;
const AMY_CID = process.env.AMY_CID;

// Function to log in and fetch authId
async function loginAndGetAuthId() {
    try {
        const loginPayload = JSON.stringify({
            CMND: "_LOGIN_",
            USER: AMY_USER,
            PASS: AMY_PASS,
            DVID: AMY_DVID,
            CID: AMY_CID,
            CMND: "_LOGINONLY_",
        });

        const config = {
            method: "post",
            url: "https://www.amybd.com/atapi.aspx",
            headers: {
                "Content-Type": "text/plain, application/x-www-form-urlencoded; charset=UTF-8",
            },
            data: loginPayload,
        };

        const response = await axios.request(config);

        // extract auth id (depends on response structure)
        if (response.data?.authid) {
            authId = response.data.authid;
            console.log("✅ Logged in, new authId:", authId);
        } else {
            throw new Error("AuthId not found in login response");
        }
    } catch (error) {
        console.error("Login failed:", error.message);
        throw error;
    }
}

// Middleware to ensure we always have a valid authId
async function ensureAuthId(req, res, next) {
    try {
        if (!authId) {
            await loginAndGetAuthId();
        }
        next();
    } catch (err) {
        res.status(500).json({ error: "Failed to login", details: err.message });
    }
}

// Flight search endpoint
app.post("/search-flight", ensureAuthId, async (req, res) => {
    try {
        // if user sends payload, use that, otherwise use your default
        const data =
            req.body && Object.keys(req.body).length > 0
                ? JSON.stringify(req.body)
                : JSON.stringify({
                    // is_combo: 0,
                    // CMND: "_FLIGHTSEARCH_",
                    // TRIP: "RT",
                    // FROM: "Dhaka - DAC - BANGLADESH",
                    // DEST: "Kuala Lumpur - KUL - MALAYSIA",
                    // JDT: "22-Sep-2025",
                    // RDT: "28-Sep-2025",
                    // ACLASS: "Y",
                    // AD: 1,
                    // CH: 0,
                    // INF: 0,
                    // Umrah: "0",
                    // DOBC1: "21-Aug-2016",
                });

        const config = {
            method: "post",
            url: "https://www.amybd.com/atapi.aspx",
            headers: {
                "Content-Type": "text/plain, application/x-www-form-urlencoded; charset=UTF-8",
                authid: authId, // use dynamic authid
            },
            data,
        };

        const response = await axios.request(config);

        // handle case when authid expires → retry login
        if (response.data?.error === "AUTH_EXPIRED") {
            console.log("⚠️ Auth expired, re-logging in...");
            await loginAndGetAuthId();
            config.headers.authid = authId;
            const retryResponse = await axios.request(config);
            return res.json(retryResponse.data);
        }

        res.json(response.data);
    } catch (error) {
        console.error("Error:", error.message);
        res.status(500).json({ error: "Something went wrong", details: error.message });
    }
});

// Health check
app.get("/status", (req, res) => {
    res.json({
        status: "ok",
        server: "running",
        api: "amybd proxy ready",
        auth: !!authId,
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
