require("dotenv").config();

const express = require("express");
const session = require("express-session");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 3000;

const mongo = new MongoClient(process.env.MONGO_URI);

let pointsCollection;
let termineCollection;

app.set("view engine", "ejs");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

app.use(session({
    secret: "lsmd-dashboard-secret",
    resave: false,
    saveUninitialized: false
}));

function requireLogin(req, res, next) {
    if (!req.session.loggedIn) {
        return res.redirect("/login");
    }

    next();
}

async function getAllPoints() {
    const users = await pointsCollection.find({}).toArray();
    return users.sort((a, b) => b.points - a.points);
}

// LOGIN
app.get("/login", (req, res) => {
    res.render("login", { error: null });
});

app.post("/login", (req, res) => {
    const { password } = req.body;

    if (password === process.env.WEB_ADMIN_PASSWORD) {
        req.session.loggedIn = true;
        return res.redirect("/");
    }

    res.render("login", { error: "Falsches Passwort" });
});

app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/login");
    });
});

// DASHBOARD
app.get("/", requireLogin, async (req, res) => {
    const users = await getAllPoints();
    const termine = await termineCollection.find({}).sort({ date: 1 }).toArray();

    res.render("dashboard", {
        users,
        termine
    });
});

// PUNKTE HINZUFÜGEN
app.post("/points/add", requireLogin, async (req, res) => {
    const { userId, points } = req.body;
    const amount = Number(points);

    if (!userId || isNaN(amount)) return res.redirect("/");

    await pointsCollection.updateOne(
        { userId },
        { $inc: { points: amount }, $set: { userId } },
        { upsert: true }
    );

    res.redirect("/");
});

// PUNKTE ENTFERNEN
app.post("/points/remove", requireLogin, async (req, res) => {
    const { userId, points } = req.body;
    const amount = Number(points);

    if (!userId || isNaN(amount)) return res.redirect("/");

    const user = await pointsCollection.findOne({ userId });
    const current = user?.points || 0;
    const newPoints = Math.max(0, current - amount);

    await pointsCollection.updateOne(
        { userId },
        { $set: { userId, points: newPoints } },
        { upsert: true }
    );

    res.redirect("/");
});

// PUNKTE SETZEN
app.post("/points/set", requireLogin, async (req, res) => {
    const { userId, points } = req.body;
    const amount = Math.max(0, Number(points));

    if (!userId || isNaN(amount)) return res.redirect("/");

    await pointsCollection.updateOne(
        { userId },
        { $set: { userId, points: amount } },
        { upsert: true }
    );

    res.redirect("/");
});

// TERMIN ERSTELLEN
app.post("/termine/create", requireLogin, async (req, res) => {
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

    await termineCollection.insertOne({
        name,
        discordId,
        examType,
        date,
        time,
        examiner,
        status: status || "offen",
        notes,
        createdAt: new Date()
    });

    res.redirect("/");
});

// TERMIN STATUS ÄNDERN
app.post("/termine/status/:id", requireLogin, async (req, res) => {
    const { status } = req.body;

    await termineCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status } }
    );

    res.redirect("/");
});

// TERMIN LÖSCHEN
app.post("/termine/delete/:id", requireLogin, async (req, res) => {
    await termineCollection.deleteOne({
        _id: new ObjectId(req.params.id)
    });

    res.redirect("/");
});

// START
async function start() {
    await mongo.connect();

    const db = mongo.db("lsmd");

    pointsCollection = db.collection("points");
    termineCollection = db.collection("examAppointments");

    app.listen(PORT, () => {
        console.log(`✅ LSMD Website läuft auf Port ${PORT}`);
    });
}

start().catch(console.error);