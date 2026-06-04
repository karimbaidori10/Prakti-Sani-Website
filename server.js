
require("dotenv").config();

const express = require("express");
const expressLayouts = require("express-ejs-layouts");
const session = require("express-session");
const { MongoClient, ObjectId } = require("mongodb");
const passport = require("passport");
const compression = require("compression");
const DiscordStrategy = require("passport-discord").Strategy;

const app = express();
const PORT = process.env.PORT || 3000;

const mongo = new MongoClient(process.env.MONGO_URI);

let pointsCollection;
let termineCollection;
let examsCollection;
let docsCollection;
let logsCollection;

const discordMemberCache = new Map();
const DISCORD_CACHE_TIME = 1000 * 60 * 10;

const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const PRAKTI_SANI_ROLE_ID = process.env.PRAKTI_SANI_ROLE_ID;
const ROLE_TESTPHASE = process.env.PRAKTI_SANI_ROLE_ID;
const ROLE_FESTES_MITGLIED = process.env.ROLE_FESTES_MITGLIED;
const ROLE_SENIOR = process.env.ROLE_SENIOR;
const ROLE_UNTERE_LEITUNG = process.env.ROLE_UNTERE_LEITUNG;
const ROLE_STV_LEITUNG = process.env.ROLE_STV_LEITUNG;
const ROLE_LEITUNG = process.env.ROLE_LEITUNG;

app.set("view engine", "ejs");

app.use(expressLayouts);
app.set("layout", "layout");

app.use(compression());

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(express.static("public", {
    maxAge: "7d",
    etag: true
}));

app.use(session({
    secret: process.env.SESSION_SECRET || "lsmd-dashboard-secret",
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((user, done) => {
    done(null, user);
});

passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL,
    scope: ["identify"]
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const response = await fetch(
            `https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${profile.id}`,
            {
                headers: {
                    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`
                }
            }
        );

        if (!response.ok) {
            return done(null, false);
        }

        const member = await response.json();
        const roles = member.roles || [];

        const isAdmin = roles.includes(ADMIN_ROLE_ID);
        const isPraktiSani = roles.includes(PRAKTI_SANI_ROLE_ID);
        const rank = getRankFromRoles(roles);


        if (!isAdmin && !isPraktiSani) {
            return done(null, false);
        }

const displayName =
    member.nick ||
    member.user?.global_name ||
    member.user?.username ||
    profile.username;

const avatarUrl = member.user?.avatar
    ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png`
    : null;

return done(null, {
    id: profile.id,
    username: displayName,
    avatar: avatarUrl,
    roles,
    isAdmin,
    role: isAdmin ? "Admin" : "Prakti-Sani",
    rank
});

    } catch (error) {
        return done(error, null);
    }
}));

function requireLogin(req, res, next) {
    if (!req.session.loggedIn) {
        return res.redirect("/login");
    }

    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.isAdmin) {
        return res.status(403).send("Kein Zugriff auf diesen Bereich.");
    }

    next();
}

function viewData(req, extra = {}) {
    return {
        user: req.session.user || null,
        isAdmin: req.session.isAdmin || false,
        active: "",
        ...extra
    };
}

function getRankFromRoles(roles = []) {
    if (roles.includes(ROLE_LEITUNG)) {
        return "Leitung";
    }

    if (roles.includes(ROLE_STV_LEITUNG)) {
        return "Stv Leitung";
    }

    if (roles.includes(ROLE_UNTERE_LEITUNG)) {
        return "Untere Leitung";
    }

    if (roles.includes(ROLE_SENIOR)) {
        return "Senior Prakti-Sani";
    }

    if (roles.includes(ROLE_FESTES_MITGLIED)) {
        return "Prakti-Sani Festes Mitglied";
    }

    if (roles.includes(ROLE_TESTPHASE)) {
        return "Prakti-Sani Testphase";
    }

    return "Kein Rang";
}

async function getDiscordMemberInfo(userId) {
    try {
        if (!userId) {
            return null;
        }

        const cached = discordMemberCache.get(userId);

        if (cached && Date.now() - cached.time < DISCORD_CACHE_TIME) {
            return cached.data;
        }

        const response = await fetch(
            `https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${userId}`,
            {
                headers: {
                    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`
                }
            }
        );

        if (!response.ok) {
            return null;
        }

        const member = await response.json();

        const displayName =
            member.nick ||
            member.user?.global_name ||
            member.user?.username ||
            userId;

        const avatarUrl = member.user?.avatar
            ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png`
            : null;

        const roles = member.roles || [];
        const rank = getRankFromRoles(roles);

        const data = {
            displayName,
            rank,
            avatarUrl
        };

        discordMemberCache.set(userId, {
            data,
            time: Date.now()
        });

        return data;
    } catch (err) {
        console.error("Fehler beim Laden des Discord Users:", err);
        return null;
    }
}

async function addLog(action, data = {}, actor = null) {
    const createdAt = new Date();

    const logEntry = {
        action,
        data,
        actor,
        createdAt
    };

    await logsCollection.insertOne(logEntry);

    if (!process.env.DISCORD_LOG_WEBHOOK) {
        console.log("DISCORD_LOG_WEBHOOK fehlt");
        return;
    }

    try {
        const actorId = actor?.discordId || actor?.id || data?.userId || null;
        const actorName =
            actor?.username ||
            actor?.displayName ||
            data?.name ||
            "Unbekannt";

        let title = "LSMD Dashboard";
        let description = `${actorName} hat eine Aktion ausgeführt.`;
        let color = 3447003;
        let emoji = "📌";

        if (action === "Login") {
            title = "Login";
            description = `${actorName} hat sich im LSMD Dashboard eingeloggt.`;
            color = 5763719;
            emoji = "🔐";
        }

        if (action === "Ausbildungstermin erstellt") {
            title = "Ausbildungstermin erstellt";
            description = `${actorName} hat einen neuen Ausbildungstermin eingetragen.`;
            color = 3447003;
            emoji = "📅";
        }

        if (action === "Ausbildungstermin bearbeitet") {
            title = "Ausbildungstermin bearbeitet";
            description = `${actorName} hat einen Ausbildungstermin bearbeitet.`;
            color = 16705372;
            emoji = "🛠️";
        }

        if (action === "Termin geloescht") {
            title = "Ausbildungstermin gelöscht";
            description = `${actorName} hat einen Ausbildungstermin gelöscht.`;
            color = 15158332;
            emoji = "🗑️";
        }

        if (action === "Dokument hinzugefuegt") {
            title = "Dokument hinzugefügt";
            description = `${actorName} hat ein neues Dokument hinzugefügt.`;
            color = 3066993;
            emoji = "📄";
        }

        if (action === "Dokument bearbeitet") {
            title = "Dokument bearbeitet";
            description = `${actorName} hat ein Dokument bearbeitet.`;
            color = 16705372;
            emoji = "✏️";
        }

        if (action === "Dokument geloescht") {
            title = "Dokument gelöscht";
            description = `${actorName} hat ein Dokument gelöscht.`;
            color = 15158332;
            emoji = "🗑️";
        }

        if (action === "Punkte hinzugefuegt" || action === "Punkte entfernt" || action === "Punkte gesetzt") {
            title = "Punkteverwaltung";
            description = `${actorName} hat Punkte im Dashboard geändert.`;
            color = 10181046;
            emoji = "🏆";
        }

        const fields = [];

        if (data.name) {
            fields.push({
                name: "Teilnehmer",
                value: String(data.name),
                inline: true
            });
        }

        if (data.title) {
            fields.push({
                name: "Dokument",
                value: String(data.title),
                inline: true
            });
        }

        if (data.type) {
            fields.push({
                name: "Kategorie",
                value: String(data.type),
                inline: true
            });
        }

        if (data.examType) {
            fields.push({
                name: "Art",
                value: String(data.examType),
                inline: true
            });
        }

        if (data.date) {
            fields.push({
                name: "Datum",
                value: String(data.date),
                inline: true
            });
        }

        if (data.time) {
            fields.push({
                name: "Uhrzeit",
                value: String(data.time),
                inline: true
            });
        }

        if (data.examiner) {
            fields.push({
                name: "Ausbilder / Prüfer",
                value: String(data.examiner),
                inline: true
            });
        }

        if (data.amount !== undefined) {
            fields.push({
                name: "Punkte",
                value: String(data.amount),
                inline: true
            });
        }

        if (data.userId) {
            fields.push({
                name: "Betroffener User",
                value: `<@${data.userId}>`,
                inline: true
            });
        }

        fields.push({
            name: "Ausgeführt von",
            value: actorId ? `<@${actorId}>` : actorName,
            inline: true
        });

        fields.push({
            name: "Zeit",
            value: createdAt.toLocaleString("de-DE"),
            inline: true
        });

        const response = await fetch(process.env.DISCORD_LOG_WEBHOOK, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username: "LSMD Dashboard Logs",
                avatar_url: "https://cdn.discordapp.com/embed/avatars/0.png",

                // EINMAL pingen, nicht doppelt
                content: "",

                allowed_mentions: {
                    parse: ["users"]
                },

                embeds: [
                    {
                        color,
                        author: {
                            name: "LSMD Dashboard System"
                        },
                        title: `${emoji} ${title}`,
                        description,
                        fields,
                        footer: {
                            text: "LSMD Dashboard"
                        },
                        timestamp: createdAt.toISOString()
                    }
                ]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Discord Webhook Fehler:", response.status, errorText);
        } else {
            console.log("Discord Log gesendet:", action);
        }
    } catch (err) {
        console.error("Discord Log konnte nicht gesendet werden:", err);
    }
}

async function getAllPoints() {
    const users = await pointsCollection.find({}).sort({ points: -1 }).toArray();

    const enrichedUsers = await Promise.all(users.map(async (user) => {
        const discordInfo = await getDiscordMemberInfo(user.userId);

        if (!discordInfo) {
            return user;
        }

if (
    user.displayName !== discordInfo.displayName ||
    user.rank !== discordInfo.rank ||
    user.avatarUrl !== discordInfo.avatarUrl
) {
    await pointsCollection.updateOne(
        { userId: user.userId },
        {
            $set: {
                displayName: discordInfo.displayName,
                rank: discordInfo.rank,
                avatarUrl: discordInfo.avatarUrl
            }
        }
    );
}

        return {
            ...user,
            displayName: discordInfo.displayName,
            rank: discordInfo.rank,
            avatarUrl: discordInfo.avatarUrl
        };
    }));

    return enrichedUsers;
}
// =====================
// LOGIN
// =====================

app.get("/login", (req, res) => {
    res.render("login", {
        layout: false,
        error: null
    });
});

app.get("/auth/discord", passport.authenticate("discord"));

app.get(
    "/auth/discord/callback",
    passport.authenticate("discord", {
        failureRedirect: "/login"
    }),
    async (req, res) => {
        req.session.loggedIn = true;
        req.session.isAdmin = req.user.isAdmin;

        req.session.user = {
            username: req.user.username,
            discordId: req.user.id,
            role: req.user.role,
            rank: req.user.rank,
avatar: req.user.avatar || null
        };

        await pointsCollection.updateOne(
            { userId: req.user.id },
            {
                $set: {
                    userId: req.user.id,
                    displayName: req.user.username,
                    rank: req.user.rank
                },
                $setOnInsert: {
                    points: 0
                }
            },
            { upsert: true }
        );

await addLog("Login", {
    userId: req.user.id,
    name: req.user.username
}, req.session.user);

        res.redirect("/dashboard");
    }
);

app.get("/logout", (req, res) => {
    req.logout(() => {
        req.session.destroy(() => {
            res.redirect("/login");
        });
    });
});

// =====================
// SEITEN
// =====================

app.get("/", requireLogin, (req, res) => {
    res.redirect("/dashboard");
});

app.get("/dashboard", requireLogin, async (req, res) => {
    const users = await getAllPoints();

    const termine = await termineCollection
        .find({})
        .sort({ createdAt: -1 })
        .limit(6)
        .toArray();

    const allTermine = await termineCollection
        .find({})
        .toArray();

    const docs = await docsCollection
        .find({})
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray();

    res.render("dashboard", viewData(req, {
        active: "dashboard",
        users,
        termine,
        allTermine,
        docs,
        mdName: req.session.user?.username || "Ausbilder"
    }));
});

app.get("/leaderboard", requireLogin, async (req, res) => {
    const users = await getAllPoints();

    res.render("leaderboard", viewData(req, {
        active: "leaderboard",
        users
    }));
});

app.get("/users", requireLogin, async (req, res) => {
    const users = await getAllPoints();

    res.render("users", viewData(req, {
        active: "users",
        users
    }));
});

app.get("/termine", requireLogin, async (req, res) => {
    const termine = await termineCollection.find({}).sort({ date: 1, time: 1 }).toArray();

    res.render("termine", viewData(req, {
        active: "termine",
        termine
    }));
});


app.get("/dokumente", requireLogin, async (req, res) => {
    const docs = await docsCollection.find({}).sort({ createdAt: -1 }).toArray();

    res.render("dokumente", viewData(req, {
        active: "dokumente",
        docs
    }));
});

app.get("/admin", requireLogin, requireAdmin, async (req, res) => {
    const users = await getAllPoints();
    const logs = await logsCollection.find({}).sort({ createdAt: -1 }).limit(50).toArray();

    res.render("admin", viewData(req, {
        active: "admin",
        users,
        logs
    }));
});

// =====================
// POINTS
// =====================

app.post("/points/add", requireLogin, requireAdmin, async (req, res) => {
    const { userId, points } = req.body;
    const amount = Number(points);

    if (!userId || isNaN(amount)) {
        return res.redirect("/admin");
    }

    await pointsCollection.updateOne(
        { userId },
        { $inc: { points: amount }, $set: { userId } },
        { upsert: true }
    );

    await addLog("Punkte hinzugefuegt", { userId, amount }, req.session.user);

    res.redirect("/admin");
});

app.post("/points/remove", requireLogin, requireAdmin, async (req, res) => {
    const { userId, points } = req.body;
    const amount = Number(points);

    if (!userId || isNaN(amount)) {
        return res.redirect("/admin");
    }

    const user = await pointsCollection.findOne({ userId });
    const current = user?.points || 0;
    const newPoints = Math.max(0, current - amount);

    await pointsCollection.updateOne(
        { userId },
        { $set: { userId, points: newPoints } },
        { upsert: true }
    );

    await addLog("Punkte entfernt", { userId, amount }, req.session.user);

    res.redirect("/admin");
});

app.post("/points/set", requireLogin, requireAdmin, async (req, res) => {
    const { userId, points } = req.body;
    const amount = Math.max(0, Number(points));

    if (!userId || isNaN(amount)) {
        return res.redirect("/admin");
    }

    await pointsCollection.updateOne(
        { userId },
        { $set: { userId, points: amount } },
        { upsert: true }
    );

    await addLog("Punkte gesetzt", { userId, amount }, req.session.user);

    res.redirect("/admin");
});

// =====================
// TERMINE
// =====================

app.post("/termine/create", requireLogin, async (req, res) => {
    const {
        name,
        examType,
        date,
        time,
        examiner,
        notes
    } = req.body;

    if (!name || !examType || !date || !examiner) {
        return res.redirect("/termine");
    }

    await termineCollection.insertOne({
        name,
        discordId: "",
        examType,
        date,
        time,
        examiner,
        status: "Offen",
        notes,
        source: "termine",
        createdAt: new Date()
    });

    await addLog("Ausbildungstermin erstellt", {
    name,
    examType,
    date,
    time,
    examiner
}, req.session.user);

    res.redirect("/termine");
});

app.get("/termine/edit/:id", requireLogin, requireAdmin, async (req, res) => {
    try {
        const termin = await termineCollection.findOne({
            _id: new ObjectId(req.params.id)
        });

        if (!termin) {
            return res.redirect("/termine");
        }

        res.render("termin-edit", viewData(req, {
            active: "termine",
            termin
        }));
    } catch (err) {
        console.error("Fehler beim Laden des Termins:", err);
        res.status(500).send("Serverfehler");
    }
});

app.post("/termine/edit/:id", requireLogin, requireAdmin, async (req, res) => {
    try {
        const {
            name,
            examType,
            date,
            time,
            examiner,
            notes
        } = req.body;

        if (!name || !examType || !date || !examiner) {
            return res.redirect("/termine/edit/" + req.params.id);
        }

        await termineCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            {
                $set: {
                    name,
                    discordId: "",
                    examType,
                    date,
                    time,
                    examiner,
                    status: "Offen",
                    notes
                }
            }
        );

        await addLog("Ausbildungstermin bearbeitet", {
    id: req.params.id,
    name,
    examType,
    date,
    time,
    examiner
}, req.session.user);

        res.redirect("/termine");
    } catch (err) {
        console.error("Fehler beim Speichern des Termins:", err);
        res.status(500).send("Serverfehler");
    }
});

app.post("/termine/status/:id", requireLogin, async (req, res) => {
    const { status } = req.body;

    await termineCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status } }
    );

    await addLog("Termin Status geaendert", { id: req.params.id, status }, req.session.user);

    res.redirect("/termine");
});

app.post("/termine/delete/:id", requireLogin, requireAdmin, async (req, res) => {
    await termineCollection.deleteOne({
        _id: new ObjectId(req.params.id)
    });

    await addLog("Termin geloescht", { id: req.params.id }, req.session.user);

    res.redirect("/termine");
});

// =====================
// DOKUMENTE
// =====================

app.post("/dokumente/create", requireLogin, requireAdmin, async (req, res) => {
    const { title, type, url, notes } = req.body;

    await docsCollection.insertOne({
        title,
        type,
        url,
        notes,
        createdAt: new Date()
    });

    await addLog("Dokument hinzugefuegt", { title, type }, req.session.user);

    res.redirect("/dokumente");
});

app.get("/dokumente/edit/:id", requireLogin, requireAdmin, async (req, res) => {
    try {
        const doc = await docsCollection.findOne({
            _id: new ObjectId(req.params.id)
        });

        if (!doc) {
            return res.status(404).send("Dokument nicht gefunden");
        }

        res.render("dokument-edit", viewData(req, {
            active: "dokumente",
            doc
        }));
    } catch (err) {
        console.error("Fehler beim Laden des Dokuments:", err);
        res.status(500).send("Serverfehler");
    }
});

app.post("/dokumente/edit/:id", requireLogin, requireAdmin, async (req, res) => {
    try {
        const { title, type, url, notes } = req.body;

        await docsCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            {
                $set: {
                    title,
                    type,
                    url,
                    notes
                }
            }
        );

        await addLog("Dokument bearbeitet", {
    id: req.params.id,
    title,
    type
}, req.session.user);

        res.redirect("/dokumente");
    } catch (err) {
        console.error("Fehler beim Speichern des Dokuments:", err);
        res.status(500).send("Serverfehler");
    }
});

app.post("/dokumente/delete/:id", requireLogin, requireAdmin, async (req, res) => {
    try {
        await docsCollection.deleteOne({
            _id: new ObjectId(req.params.id)
        });

        await addLog("Dokument geloescht", { id: req.params.id }, req.session.user);

        res.redirect("/dokumente");
    } catch (err) {
        console.error("Fehler beim Loeschen des Dokuments:", err);
        res.status(500).send("Serverfehler");
    }
});

// =====================
// START
// =====================

async function start() {
    await mongo.connect();

    const db = mongo.db("lsmd");

    pointsCollection = db.collection("points");
    termineCollection = db.collection("examAppointments");
    examsCollection = db.collection("exams");
    docsCollection = db.collection("documents");
    logsCollection = db.collection("dashboardLogs");

    app.listen(PORT, () => {
        console.log(`LSMD Website laeuft auf Port ${PORT}`);
    });
}

start().catch(console.error);
