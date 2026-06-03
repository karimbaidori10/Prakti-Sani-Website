
require("dotenv").config();

const express = require("express");
const expressLayouts = require("express-ejs-layouts");
const session = require("express-session");
const { MongoClient, ObjectId } = require("mongodb");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;

const app = express();
const PORT = process.env.PORT || 3000;

const mongo = new MongoClient(process.env.MONGO_URI);

let pointsCollection;
let termineCollection;
let examsCollection;
let docsCollection;
let logsCollection;

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

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

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

        return done(null, {
    id: profile.id,
    username: profile.username,
    avatar: profile.avatar,
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

        return {
            displayName,
            rank,
            avatarUrl
        };
    } catch (err) {
        console.error("Fehler beim Laden des Discord Users:", err);
        return null;
    }
}

async function addLog(action, data = {}) {
    await logsCollection.insertOne({
        action,
        data,
        createdAt: new Date()
    });
}

async function getAllPoints() {
    const users = await pointsCollection.find({}).sort({ points: -1 }).toArray();

    const enrichedUsers = await Promise.all(users.map(async (user) => {
        const discordInfo = await getDiscordMemberInfo(user.userId);

        if (!discordInfo) {
            return user;
        }

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
            avatar: req.user.avatar
                ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png`
                : null
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
    const termine = await termineCollection.find({}).sort({ date: 1 }).limit(5).toArray();
    const exams = await examsCollection.find({}).sort({ createdAt: -1 }).limit(5).toArray();

    res.render("dashboard", viewData(req, {
        active: "dashboard",
        users,
        termine,
        exams
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

app.get("/pruefungen", requireLogin, async (req, res) => {
    const exams = await examsCollection.find({}).sort({ createdAt: -1 }).toArray();

    res.render("pruefungen", viewData(req, {
        active: "pruefungen",
        exams
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

    await addLog("Punkte hinzugefuegt", { userId, amount });

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

    await addLog("Punkte entfernt", { userId, amount });

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

    await addLog("Punkte gesetzt", { userId, amount });

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
    });

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
            discordId,
            examType,
            date,
            time,
            examiner,
            status,
            notes
        } = req.body;

        await termineCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            {
                $set: {
                    name,
                    discordId,
                    examType,
                    date,
                    time,
                    examiner,
                    status,
                    notes
                }
            }
        );

        await addLog("Termin bearbeitet", {
            id: req.params.id,
            name,
            examType,
            date,
            time
        });

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

    await addLog("Termin Status geaendert", { id: req.params.id, status });

    res.redirect("/termine");
});

app.post("/termine/delete/:id", requireLogin, requireAdmin, async (req, res) => {
    await termineCollection.deleteOne({
        _id: new ObjectId(req.params.id)
    });

    await addLog("Termin geloescht", { id: req.params.id });

    res.redirect("/termine");
});

// =====================
// PRUEFUNGEN
// =====================

app.get("/pruefungen/edit/:id", requireLogin, async (req, res) => {
    const exam = await examsCollection.findOne({
        _id: new ObjectId(req.params.id)
    });

    if (!exam) {
        return res.redirect("/pruefungen");
    }

    res.render("pruefung-edit", viewData(req, {
        active: "pruefungen",
        exam
    }));
});

app.post("/pruefungen/create", requireLogin, async (req, res) => {
    const {
        name,
        date,
        time,
        examType,
        examiner,
        notes
    } = req.body;

    if (!name || !examType || !date || !examiner) {
        return res.redirect("/pruefungen");
    }

    const examResult = await examsCollection.insertOne({
        name,
        discordId: "",
        date,
        time,
        examType,
        result: "Offen",
        examiner,
        notes,
        createdAt: new Date()
    });

    if (examType === "Sanitaeter-Pruefung") {
        await termineCollection.insertOne({
            sourceExamId: examResult.insertedId.toString(),
            name,
            discordId: "",
            examType,
            date,
            time,
            examiner,
            status: "Offen",
            notes,
            source: "pruefung",
            createdAt: new Date()
        });
    }

    await addLog("Pruefung gespeichert", {
        name,
        examType
    });

    res.redirect("/pruefungen");
});

app.post("/pruefungen/edit/:id", requireLogin, async (req, res) => {
    const {
        name,
        date,
        time,
        examType,
        examiner,
        notes
    } = req.body;

    if (!name || !examType || !date || !examiner) {
        return res.redirect("/pruefungen/edit/" + req.params.id);
    }

    await examsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        {
            $set: {
                name,
                discordId: "",
                date,
                time,
                examType,
                result: "Offen",
                examiner,
                notes
            }
        }
    );

    if (examType === "Sanitaeter-Pruefung") {
        await termineCollection.updateOne(
            { sourceExamId: req.params.id },
            {
                $set: {
                    sourceExamId: req.params.id,
                    name,
                    discordId: "",
                    examType,
                    date,
                    time,
                    examiner,
                    status: "Offen",
                    notes,
                    source: "pruefung",
                    updatedAt: new Date()
                },
                $setOnInsert: {
                    createdAt: new Date()
                }
            },
            { upsert: true }
        );
    } else {
        await termineCollection.deleteOne({
            sourceExamId: req.params.id
        });
    }

    await addLog("Pruefung bearbeitet", {
        id: req.params.id,
        name,
        examType
    });

    res.redirect("/pruefungen");
});

app.post("/pruefungen/delete/:id", requireLogin, requireAdmin, async (req, res) => {
    await examsCollection.deleteOne({
        _id: new ObjectId(req.params.id)
    });

    await termineCollection.deleteOne({
        sourceExamId: req.params.id
    });

    await addLog("Pruefung geloescht", {
        id: req.params.id
    });

    res.redirect("/pruefungen");
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

    await addLog("Dokument hinzugefuegt", { title, type });

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

        await addLog("Dokument bearbeitet", { id: req.params.id, title, type });

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

        await addLog("Dokument geloescht", { id: req.params.id });

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
